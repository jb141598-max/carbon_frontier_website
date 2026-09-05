import { getDatabase } from "@netlify/database";
import {
  createViewer,
  findRole,
  insertAuditEntry,
  json,
  loadAccessState,
  verifyGoogleRequest,
  verifyMutationOrigin,
} from "./_shared/wiki-security.mjs";

const db = getDatabase();
const MAX_DEFINITION_BYTES = 100_000;
const MAX_ELEMENTS = 100;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ELEMENT_TYPES = new Set(["text", "placeholder", "shape", "frame", "line", "image"]);
const SHAPES = new Set(["rectangle", "ellipse", "triangle", "diamond", "rounded"]);
const FONT_FAMILIES = new Set(["Play", "Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"]);
const TEXT_ALIGNS = new Set(["left", "center", "right"]);

export const config = {
  path: ["/api/wiki/templates", "/api/wiki/templates/:id"],
};

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function requestedTemplateId(request) {
  const url = new URL(request.url);
  const prefix = "/api/wiki/templates/";
  const raw = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : url.searchParams.get("id") || "";
  try {
    return decodeURIComponent(raw).trim();
  } catch (error) {
    return "";
  }
}

function cleanText(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function finiteNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function cleanColor(value, fallback) {
  const color = String(value || "").trim().toLowerCase();
  return color === "transparent" || /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

function cleanElement(raw, index, canvas) {
  const type = ELEMENT_TYPES.has(raw?.type) ? raw.type : "shape";
  const element = {
    id: cleanText(raw?.id, 80) || `element-${index + 1}`,
    type,
    x: finiteNumber(raw?.x, -canvas.width, canvas.width * 2, 30),
    y: finiteNumber(raw?.y, -canvas.height, canvas.height * 2, 30),
    width: finiteNumber(raw?.width, 8, canvas.width * 2, 180),
    height: finiteNumber(raw?.height, 8, canvas.height * 2, 80),
    rotation: finiteNumber(raw?.rotation, -360, 360, 0),
    zIndex: Math.round(finiteNumber(raw?.zIndex, -1000, 1000, index + 1)),
    opacity: finiteNumber(raw?.opacity, 0.05, 1, 1),
  };

  if (type === "text" || type === "placeholder") {
    element.fontFamily = FONT_FAMILIES.has(raw?.fontFamily) ? raw.fontFamily : "Play";
    element.fontSize = finiteNumber(raw?.fontSize, 8, 144, 24);
    element.fontWeight = Number(raw?.fontWeight) >= 700 ? 700 : 400;
    element.fontStyle = raw?.fontStyle === "italic" ? "italic" : "normal";
    element.textAlign = TEXT_ALIGNS.has(raw?.textAlign) ? raw.textAlign : "left";
    element.color = cleanColor(raw?.color, "#ffffff");
    if (type === "placeholder") {
      element.placeholderKey = slugify(raw?.placeholderKey).replaceAll("-", "_").slice(0, 60) || `value_${index + 1}`;
      element.defaultValue = String(raw?.defaultValue || "Placeholder text").slice(0, 500);
    } else {
      element.text = String(raw?.text || "Text").slice(0, 1000);
    }
  } else if (type === "line") {
    element.stroke = cleanColor(raw?.stroke, "#ffffff");
    element.strokeWidth = finiteNumber(raw?.strokeWidth, 1, 24, 3);
  } else if (type === "image") {
    element.mediaId = cleanText(raw?.mediaId, 100);
    element.url = /^(?:data:image\/|https:\/\/)/i.test(String(raw?.url || ""))
      ? String(raw.url).slice(0, 6_000_000)
      : "";
    element.alt = String(raw?.alt || "Template image").slice(0, 240);
    element.fit = raw?.fit === "contain" ? "contain" : "cover";
    element.borderRadius = finiteNumber(raw?.borderRadius, 0, 200, 0);
  } else {
    element.shape = SHAPES.has(raw?.shape) ? raw.shape : "rectangle";
    element.fill = cleanColor(raw?.fill, type === "frame" ? "transparent" : "#df2531");
    element.stroke = cleanColor(raw?.stroke, "#ffffff");
    element.strokeWidth = finiteNumber(raw?.strokeWidth, 0, 24, type === "frame" ? 3 : 1);
    element.borderRadius = finiteNumber(raw?.borderRadius, 0, 200, type === "frame" ? 16 : 8);
  }
  return element;
}

function normalizeDefinition(value, requestedWidth, requestedHeight) {
  const canvas = {
    width: Math.round(finiteNumber(value?.canvas?.width ?? requestedWidth, 240, 1600, 720)),
    height: Math.round(finiteNumber(value?.canvas?.height ?? requestedHeight, 120, 1600, 420)),
    backgroundColor: cleanColor(value?.canvas?.backgroundColor, "#111111"),
  };
  const rawElements = Array.isArray(value?.elements) ? value.elements.slice(0, MAX_ELEMENTS) : [];
  const usedIds = new Set();
  const elements = rawElements.map((raw, index) => {
    const element = cleanElement(raw, index, canvas);
    let id = element.id;
    let suffix = 2;
    while (usedIds.has(id)) id = `${element.id}-${suffix++}`;
    usedIds.add(id);
    element.id = id;
    return element;
  });
  const definition = { version: 1, canvas, elements };
  const serialized = JSON.stringify(definition);
  if (new TextEncoder().encode(serialized).length > MAX_DEFINITION_BYTES) {
    return { ok: false, message: "Template designs must be 100 KB or smaller." };
  }
  return { ok: true, definition, serialized };
}

function placeholdersFromDefinition(definition) {
  const placeholders = [];
  const seen = new Set();
  for (const element of definition?.elements || []) {
    if (element.type !== "placeholder" || seen.has(element.placeholderKey)) continue;
    seen.add(element.placeholderKey);
    placeholders.push({
      key: element.placeholderKey,
      label: element.placeholderKey.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      defaultValue: element.defaultValue || "",
    });
  }
  return placeholders;
}

function templateFromRow(row, viewer, { includeDefinition = true } = {}) {
  const definition = includeDefinition ? row.definition_json : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    canvas: { width: Number(row.canvas_width), height: Number(row.canvas_height) },
    isDeleted: row.is_deleted === true,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    currentRevision: row.revision_id ? {
      id: row.revision_id,
      number: Number(row.revision_number),
      definition,
      editSummary: row.edit_summary || "",
      authorName: row.author_name || null,
      authorRole: row.author_role || "wiki_editor",
      createdAt: new Date(row.revision_created_at).toISOString(),
    } : null,
    placeholders: placeholdersFromDefinition(definition || row.definition_json),
    permissions: {
      canEdit: viewer.isAssignedStaff,
      canDelete: viewer.isAssignedStaff,
    },
  };
}

async function selectTemplate(client, idOrSlug, { lock = false } = {}) {
  const result = await client.query(
    `SELECT t.id, t.slug, t.name, t.description, t.canvas_width, t.canvas_height,
            t.is_deleted, t.created_at, t.updated_at,
            r.id AS revision_id, r.revision_number, r.definition_json,
            r.edit_summary, r.author_name, r.author_role, r.created_at AS revision_created_at
     FROM wiki_templates t
     LEFT JOIN wiki_template_revisions r ON r.id = t.current_revision_id
     WHERE (t.id = $1 OR t.slug = $1) AND t.is_deleted = FALSE
     ${lock ? "FOR UPDATE OF t" : ""}`,
    [idOrSlug]
  );
  return result.rows[0] || null;
}

async function loadViewer(client, account) {
  const state = await loadAccessState(client);
  return { state, viewer: createViewer(state, account) };
}

async function handleGet(request, account) {
  const client = await db.pool.connect();
  try {
    const { viewer } = await loadViewer(client, account);
    if (!viewer.canView) return json({ error: "Wiki not available." }, 403);
    const id = requestedTemplateId(request);
    if (id) {
      const row = await selectTemplate(client, id);
      if (!row) return json({ error: "Wiki template not found." }, 404);
      return json({ ok: true, template: templateFromRow(row, viewer) });
    }
    const result = await client.query(
      `SELECT t.id, t.slug, t.name, t.description, t.canvas_width, t.canvas_height,
              t.is_deleted, t.created_at, t.updated_at,
              r.id AS revision_id, r.revision_number, r.definition_json,
              r.edit_summary, r.author_name, r.author_role, r.created_at AS revision_created_at
       FROM wiki_templates t
       LEFT JOIN wiki_template_revisions r ON r.id = t.current_revision_id
       WHERE t.is_deleted = FALSE
       ORDER BY t.updated_at DESC, t.name ASC
       LIMIT 250`
    );
    return json({
      ok: true,
      permissions: { canCreate: viewer.isAssignedStaff, canEdit: viewer.isAssignedStaff },
      templates: result.rows.map((row) => templateFromRow(row, viewer)),
    });
  } finally {
    client.release();
  }
}

async function handleCreate(account, body) {
  const name = cleanText(body?.name, 100);
  const slug = normalizeSlug(body?.slug) || slugify(name);
  const description = cleanText(body?.description, 500);
  const normalized = normalizeDefinition(body?.definition, body?.canvasWidth, body?.canvasHeight);
  if (!name) return json({ error: "Enter a template name." }, 400);
  if (!SLUG_PATTERN.test(slug) || slug.length > 100) return json({ error: "Use a lowercase template address with hyphens." }, 400);
  if (!normalized.ok) return json({ error: normalized.message }, 400);

  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const { state, viewer } = await loadViewer(client, account);
    if (!viewer.isAssignedStaff) return json({ error: "Only assigned wiki staff can create templates." }, 403);
    const conflict = await client.query(`SELECT 1 FROM wiki_templates WHERE slug = $1`, [slug]);
    if (conflict.rowCount) return json({ error: "That template address is already in use." }, 409);
    const templateId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    await client.query(
      `INSERT INTO wiki_templates (
         id, slug, name, description, canvas_width, canvas_height,
         created_by_email, updated_by_email
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [templateId, slug, name, description, normalized.definition.canvas.width, normalized.definition.canvas.height, account.email]
    );
    await client.query(
      `INSERT INTO wiki_template_revisions (
         id, template_id, revision_number, definition_json, edit_summary,
         author_email, author_name, author_role
       ) VALUES ($1, $2, 1, $3::jsonb, $4, $5, $6, $7)`,
      [revisionId, templateId, normalized.serialized, cleanText(body?.editSummary || "Create template", 300), account.email, account.name || null, findRole(state, account.email)]
    );
    await client.query(`UPDATE wiki_templates SET current_revision_id = $1 WHERE id = $2`, [revisionId, templateId]);
    await insertAuditEntry(client, {
      action: "wiki_template_created", actorEmail: account.email,
      details: { templateId, slug, name, placeholderCount: placeholdersFromDefinition(normalized.definition).length },
    });
    await client.query("COMMIT");
    committed = true;
    const row = await selectTemplate(client, templateId);
    return json({ ok: true, template: templateFromRow(row, viewer) }, 201);
  } catch (error) {
    if (error?.code === "23505") return json({ error: "That template address is already in use." }, 409);
    throw error;
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

async function handleUpdate(account, id, body) {
  if (!id) return json({ error: "Choose a template to update." }, 400);
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const { state, viewer } = await loadViewer(client, account);
    if (!viewer.isAssignedStaff) return json({ error: "Only assigned wiki staff can edit templates." }, 403);
    const row = await selectTemplate(client, id, { lock: true });
    if (!row) return json({ error: "Wiki template not found." }, 404);
    if (body?.action === "trash_template") {
      await client.query(
        `UPDATE wiki_templates SET is_deleted = TRUE, updated_at = NOW(), updated_by_email = $1 WHERE id = $2`,
        [account.email, row.id]
      );
      await insertAuditEntry(client, {
        action: "wiki_template_trashed", actorEmail: account.email,
        details: { templateId: row.id, slug: row.slug, name: row.name },
      });
      await client.query("COMMIT");
      committed = true;
      return json({ ok: true, trashed: { id: row.id, slug: row.slug, name: row.name } });
    }
    const baseRevisionId = cleanText(body?.baseRevisionId, 100);
    if (!baseRevisionId || baseRevisionId !== row.revision_id) {
      return json({
        error: "This template changed after you opened it. Reload before saving.",
        code: "template_revision_conflict",
        currentRevisionId: row.revision_id,
        currentRevisionNumber: Number(row.revision_number),
      }, 409);
    }
    const name = body?.name === undefined ? row.name : cleanText(body.name, 100);
    const description = body?.description === undefined ? row.description : cleanText(body.description, 500);
    const normalized = normalizeDefinition(body?.definition, row.canvas_width, row.canvas_height);
    if (!name) return json({ error: "Enter a template name." }, 400);
    if (!normalized.ok) return json({ error: normalized.message }, 400);
    const revisionId = crypto.randomUUID();
    const revisionNumber = Number(row.revision_number) + 1;
    await client.query(
      `INSERT INTO wiki_template_revisions (
         id, template_id, revision_number, definition_json, edit_summary,
         author_email, author_name, author_role
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [revisionId, row.id, revisionNumber, normalized.serialized, cleanText(body?.editSummary, 300), account.email, account.name || null, findRole(state, account.email)]
    );
    await client.query(
      `UPDATE wiki_templates
       SET name = $1, description = $2, canvas_width = $3, canvas_height = $4,
           current_revision_id = $5, updated_at = NOW(), updated_by_email = $6
       WHERE id = $7`,
      [name, description, normalized.definition.canvas.width, normalized.definition.canvas.height, revisionId, account.email, row.id]
    );
    await insertAuditEntry(client, {
      action: "wiki_template_updated", actorEmail: account.email,
      details: { templateId: row.id, slug: row.slug, name, revisionNumber, placeholderCount: placeholdersFromDefinition(normalized.definition).length },
    });
    await client.query("COMMIT");
    committed = true;
    const updated = await selectTemplate(client, row.id);
    return json({ ok: true, template: templateFromRow(updated, viewer) });
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

export default async function handler(request) {
  try {
    if (request.method === "GET") {
      const auth = await verifyGoogleRequest(request, { optional: true });
      if (!auth.ok) return json({ error: auth.message }, auth.status);
      return handleGet(request, auth.account);
    }
    if (!verifyMutationOrigin(request)) return json({ error: "Cross-site template request blocked." }, 403);
    const auth = await verifyGoogleRequest(request);
    if (!auth.ok) return json({ error: auth.message }, auth.status);
    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      return handleCreate(auth.account, body);
    }
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => null);
      return handleUpdate(auth.account, requestedTemplateId(request), body);
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("wiki-templates failed", error);
    return json({ error: "The wiki template service could not complete this request." }, 500);
  }
}
