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
const MAX_CONTENT_BYTES = 250_000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const config = {
  path: ["/api/wiki/pages", "/api/wiki/pages/:slug"],
};

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function requestedSlug(request) {
  const url = new URL(request.url);
  const directPrefix = "/api/wiki/pages/";
  const fromPath = url.pathname.startsWith(directPrefix)
    ? url.pathname.slice(directPrefix.length)
    : "";
  const value = fromPath || url.searchParams.get("slug") || "";
  try {
    return normalizeSlug(decodeURIComponent(value));
  } catch (error) {
    return "";
  }
}

function validateSlug(slug) {
  return slug.length <= 100 && SLUG_PATTERN.test(slug);
}

function normalizeTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function validateContent(value) {
  if (!value || typeof value !== "object") {
    return { ok: false, message: "Page content must be a JSON object or array." };
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    return { ok: false, message: "Page content must be valid JSON." };
  }
  if (new TextEncoder().encode(serialized).length > MAX_CONTENT_BYTES) {
    return { ok: false, message: "Page content is too large." };
  }
  return { ok: true, serialized };
}

function pageFromRow(row, viewer) {
  const canEditThisPage =
    viewer.isAssignedStaff || (viewer.canEdit && row.allow_normal_edits === true);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    allowNormalEdits: row.allow_normal_edits,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    currentRevision: row.revision_id
      ? {
          id: row.revision_id,
          number: Number(row.revision_number),
          title: row.revision_title || row.title,
          content: row.content_json,
          editSummary: row.edit_summary,
          authorName: row.author_name || null,
          authorRole: row.author_role || "contributor",
          createdAt: new Date(row.revision_created_at).toISOString(),
        }
      : null,
    permissions: {
      canEdit: canEditThisPage,
      canChangePageSettings: viewer.isAssignedStaff,
      canRestoreRevisions: viewer.isAssignedStaff,
    },
  };
}

async function loadSecurity(client, account) {
  const state = await loadAccessState(client);
  return { state, viewer: createViewer(state, account) };
}

async function selectPage(client, slug, { lock = false } = {}) {
  const result = await client.query(
    `SELECT
       p.id,
       p.slug,
       p.title,
       p.allow_normal_edits,
       p.created_at,
       p.updated_at,
       r.id AS revision_id,
       r.revision_number,
       r.page_title AS revision_title,
       r.content_json,
       r.edit_summary,
       r.author_name,
       r.author_role,
       r.created_at AS revision_created_at
     FROM wiki_pages p
     LEFT JOIN wiki_revisions r ON r.id = p.current_revision_id
     WHERE p.slug = $1 AND p.is_deleted = FALSE
     ${lock ? "FOR UPDATE OF p" : ""}`,
    [slug]
  );
  return result.rows[0] || null;
}

async function handleGet(request, account) {
  const client = await db.pool.connect();
  try {
    const { viewer } = await loadSecurity(client, account);
    if (!viewer.canView) {
      return json({ error: "Wiki not available." }, 403);
    }

    const slug = requestedSlug(request);
    if (!slug) {
      const search = String(new URL(request.url).searchParams.get("q") || "")
        .trim()
        .slice(0, 80);
      const searchPattern = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const result = await client.query(
        `SELECT
           p.id,
           p.slug,
           p.title,
           p.allow_normal_edits,
           p.updated_at,
           r.revision_number,
           r.edit_summary,
           r.author_name
         FROM wiki_pages p
         LEFT JOIN wiki_revisions r ON r.id = p.current_revision_id
         WHERE p.is_deleted = FALSE
           AND ($1 = '' OR p.title ILIKE $2 ESCAPE '\\' OR p.slug ILIKE $2 ESCAPE '\\')
         ORDER BY p.updated_at DESC, p.title ASC
         LIMIT 250`,
        [search, searchPattern]
      );
      return json({
        ok: true,
        query: search,
        permissions: {
          canCreate: viewer.canEdit,
          isAssignedStaff: viewer.isAssignedStaff,
        },
        pages: result.rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          allowNormalEdits: row.allow_normal_edits,
          updatedAt: new Date(row.updated_at).toISOString(),
          revisionNumber: row.revision_number ? Number(row.revision_number) : null,
          editSummary: row.edit_summary || "",
          authorName: row.author_name || null,
        })),
      });
    }

    if (!validateSlug(slug)) {
      return json({ error: "That wiki page address is invalid." }, 400);
    }
    const pageRow = await selectPage(client, slug);
    if (!pageRow) {
      return json({ error: "Wiki page not found." }, 404);
    }

    const pageUrl = new URL(request.url);
    if (pageUrl.searchParams.get("history") === "1") {
      const revisions = await client.query(
        `SELECT id, revision_number, page_title, edit_summary, author_name,
                author_role, created_at
         FROM wiki_revisions
         WHERE page_id = $1
         ORDER BY revision_number DESC
         LIMIT 200`,
        [pageRow.id]
      );
      return json({
        ok: true,
        page: pageFromRow(pageRow, viewer),
        revisions: revisions.rows.map((row) => ({
          id: row.id,
          number: Number(row.revision_number),
          title: row.page_title,
          editSummary: row.edit_summary,
          authorName: row.author_name || null,
          authorRole: row.author_role || "contributor",
          createdAt: new Date(row.created_at).toISOString(),
          isCurrent: row.id === pageRow.revision_id,
        })),
      });
    }

    if (pageUrl.searchParams.has("revision")) {
      const revisionNumber = Number(pageUrl.searchParams.get("revision"));
      if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1) {
        return json({ error: "That revision number is invalid." }, 400);
      }
      const revisionResult = await client.query(
        `SELECT id, revision_number, page_title, content_json, edit_summary,
                author_name, author_role, created_at
         FROM wiki_revisions
         WHERE page_id = $1 AND revision_number = $2`,
        [pageRow.id, revisionNumber]
      );
      const revision = revisionResult.rows[0];
      if (!revision) {
        return json({ error: "Wiki revision not found." }, 404);
      }
      return json({
        ok: true,
        page: pageFromRow(pageRow, viewer),
        revision: {
          id: revision.id,
          number: Number(revision.revision_number),
          title: revision.page_title,
          content: revision.content_json,
          editSummary: revision.edit_summary,
          authorName: revision.author_name || null,
          authorRole: revision.author_role || "contributor",
          createdAt: new Date(revision.created_at).toISOString(),
          isCurrent: revision.id === pageRow.revision_id,
        },
      });
    }

    return json({ ok: true, page: pageFromRow(pageRow, viewer) });
  } finally {
    client.release();
  }
}

async function handleCreate(request, account, body) {
  const slug = normalizeSlug(body?.slug);
  const title = normalizeTitle(body?.title);
  const contentResult = validateContent(body?.content);
  const editSummary = String(body?.editSummary || "Create page").trim().slice(0, 300);

  if (!validateSlug(slug)) {
    return json({ error: "Use a lowercase page address with words separated by hyphens." }, 400);
  }
  if (!title || title.length > 120) {
    return json({ error: "Page titles must be between 1 and 120 characters." }, 400);
  }
  if (!contentResult.ok) {
    return json({ error: contentResult.message }, 400);
  }

  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const { state, viewer } = await loadSecurity(client, account);
    if (!viewer.canEdit) {
      return json({ error: "This account cannot create wiki pages." }, 403);
    }

    const pageId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const authorRole = findRole(state, account.email) || "contributor";
    await client.query(
      `INSERT INTO wiki_pages (
         id, slug, title, allow_normal_edits, created_by_email, updated_by_email
       ) VALUES ($1, $2, $3, TRUE, $4, $4)`,
      [pageId, slug, title, account.email]
    );
    await client.query(
      `INSERT INTO wiki_revisions (
         id, page_id, revision_number, page_title, content_json, edit_summary,
         author_email, author_name, author_role
       ) VALUES ($1, $2, 1, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        revisionId,
        pageId,
        title,
        contentResult.serialized,
        editSummary,
        account.email,
        account.name || null,
        authorRole,
      ]
    );
    await client.query(
      `UPDATE wiki_pages SET current_revision_id = $1 WHERE id = $2`,
      [revisionId, pageId]
    );
    await insertAuditEntry(client, {
      action: "page_created",
      actorEmail: account.email,
      pageId,
      details: { slug, title, allowNormalEdits: true },
    });
    await client.query("COMMIT");
    committed = true;

    const pageRow = await selectPage(client, slug);
    return json({ ok: true, page: pageFromRow(pageRow, viewer) }, 201);
  } catch (error) {
    if (error?.code === "23505") {
      return json({ error: "A wiki page already uses that address." }, 409);
    }
    throw error;
  } finally {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => {});
    }
    client.release();
  }
}

async function handlePageMutation(request, account, body, slug) {
  if (!validateSlug(slug)) {
    return json({ error: "That wiki page address is invalid." }, 400);
  }

  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const { state, viewer } = await loadSecurity(client, account);
    const pageRow = await selectPage(client, slug, { lock: true });
    if (!pageRow) {
      return json({ error: "Wiki page not found." }, 404);
    }

    if (body?.action === "update_page_settings") {
      if (!viewer.isAssignedStaff) {
        return json({ error: "Only assigned wiki staff can change page permissions." }, 403);
      }
      if (typeof body.allowNormalEdits !== "boolean") {
        return json({ error: "Choose whether normal contributors may edit this page." }, 400);
      }

      await client.query(
        `UPDATE wiki_pages
         SET allow_normal_edits = $1,
             updated_at = NOW(),
             updated_by_email = $2
         WHERE id = $3`,
        [body.allowNormalEdits, account.email, pageRow.id]
      );
      await insertAuditEntry(client, {
        action: "page_editing_changed",
        actorEmail: account.email,
        pageId: pageRow.id,
        details: { allowNormalEdits: body.allowNormalEdits },
      });
      await client.query("COMMIT");
      committed = true;
      const updated = await selectPage(client, slug);
      return json({ ok: true, page: pageFromRow(updated, viewer) });
    }

    if (body?.action === "restore_revision") {
      if (!viewer.isAssignedStaff) {
        return json({ error: "Only assigned wiki staff can restore revisions." }, 403);
      }
      const baseRevisionId = String(body?.baseRevisionId || "").trim();
      if (!baseRevisionId || baseRevisionId !== pageRow.revision_id) {
        return json(
          {
            error: "This page changed after the history was opened. Reload before restoring.",
            code: "revision_conflict",
            currentRevisionId: pageRow.revision_id,
            currentRevisionNumber: Number(pageRow.revision_number),
          },
          409
        );
      }
      const restoreRevisionId = String(body?.revisionId || "").trim();
      const restoreResult = await client.query(
        `SELECT id, revision_number, page_title, content_json
         FROM wiki_revisions
         WHERE id = $1 AND page_id = $2`,
        [restoreRevisionId, pageRow.id]
      );
      const restoreRevision = restoreResult.rows[0];
      if (!restoreRevision) {
        return json({ error: "The revision selected for restoration was not found." }, 404);
      }
      if (restoreRevision.id === pageRow.revision_id) {
        return json({ error: "That revision is already the current version." }, 400);
      }

      const revisionId = crypto.randomUUID();
      const revisionNumber = Number(pageRow.revision_number) + 1;
      const restoredNumber = Number(restoreRevision.revision_number);
      const authorRole = findRole(state, account.email) || "wiki_editor";
      const editSummary = String(
        body?.editSummary || `Restore revision ${restoredNumber}`
      )
        .trim()
        .slice(0, 300);
      await client.query(
        `INSERT INTO wiki_revisions (
           id, page_id, revision_number, page_title, content_json, edit_summary,
           author_email, author_name, author_role
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
        [
          revisionId,
          pageRow.id,
          revisionNumber,
          restoreRevision.page_title,
          JSON.stringify(restoreRevision.content_json),
          editSummary,
          account.email,
          account.name || null,
          authorRole,
        ]
      );
      await client.query(
        `UPDATE wiki_pages
         SET title = $1,
             current_revision_id = $2,
             updated_at = NOW(),
             updated_by_email = $3
         WHERE id = $4`,
        [restoreRevision.page_title, revisionId, account.email, pageRow.id]
      );
      await insertAuditEntry(client, {
        action: "page_revision_restored",
        actorEmail: account.email,
        pageId: pageRow.id,
        details: {
          restoredRevisionId: restoreRevision.id,
          restoredRevisionNumber: restoredNumber,
          newRevisionId: revisionId,
          newRevisionNumber: revisionNumber,
        },
      });
      await client.query("COMMIT");
      committed = true;

      const restored = await selectPage(client, slug);
      return json({ ok: true, page: pageFromRow(restored, viewer) });
    }

    const canEditThisPage =
      viewer.isAssignedStaff || (viewer.canEdit && pageRow.allow_normal_edits === true);
    if (!canEditThisPage) {
      return json({ error: "Editing is disabled for this page." }, 403);
    }

    const baseRevisionId = String(body?.baseRevisionId || "").trim();
    if (!baseRevisionId) {
      return json({ error: "The revision you started editing from is required." }, 400);
    }
    if (baseRevisionId !== pageRow.revision_id) {
      return json(
        {
          error: "This page changed after you opened it. Reload before saving.",
          code: "revision_conflict",
          currentRevisionId: pageRow.revision_id,
          currentRevisionNumber: Number(pageRow.revision_number),
        },
        409
      );
    }

    const title = body?.title === undefined ? pageRow.title : normalizeTitle(body.title);
    const contentResult = validateContent(body?.content);
    const editSummary = String(body?.editSummary || "").trim().slice(0, 300);
    if (!title || title.length > 120) {
      return json({ error: "Page titles must be between 1 and 120 characters." }, 400);
    }
    if (!contentResult.ok) {
      return json({ error: contentResult.message }, 400);
    }

    const revisionId = crypto.randomUUID();
    const revisionNumber = Number(pageRow.revision_number) + 1;
    const authorRole = findRole(state, account.email) || "contributor";
    await client.query(
      `INSERT INTO wiki_revisions (
         id, page_id, revision_number, page_title, content_json, edit_summary,
         author_email, author_name, author_role
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      [
        revisionId,
        pageRow.id,
        revisionNumber,
        title,
        contentResult.serialized,
        editSummary,
        account.email,
        account.name || null,
        authorRole,
      ]
    );
    await client.query(
      `UPDATE wiki_pages
       SET title = $1,
           current_revision_id = $2,
           updated_at = NOW(),
           updated_by_email = $3
       WHERE id = $4`,
      [title, revisionId, account.email, pageRow.id]
    );
    await insertAuditEntry(client, {
      action: "page_revision_saved",
      actorEmail: account.email,
      pageId: pageRow.id,
      details: { revisionId, revisionNumber, editSummary },
    });
    await client.query("COMMIT");
    committed = true;

    const updated = await selectPage(client, slug);
    return json({ ok: true, page: pageFromRow(updated, viewer) });
  } finally {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => {});
    }
    client.release();
  }
}

export default async function handler(request) {
  try {
    if (request.method === "GET") {
      const auth = await verifyGoogleRequest(request, { optional: true });
      if (!auth.ok) {
        return json({ error: auth.message }, auth.status);
      }
      return handleGet(request, auth.account);
    }

    if (!["POST", "PUT", "PATCH"].includes(request.method)) {
      return json({ error: "Method not allowed." }, 405);
    }
    if (!verifyMutationOrigin(request)) {
      return json({ error: "Cross-site wiki page request blocked." }, 403);
    }

    const auth = await verifyGoogleRequest(request);
    if (!auth.ok) {
      return json({ error: auth.message }, auth.status);
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    const slug = requestedSlug(request);
    if (request.method === "POST" && !slug) {
      return handleCreate(request, auth.account, body);
    }
    return handlePageMutation(request, auth.account, body, slug);
  } catch (error) {
    console.error("wiki-pages failed", error);
    return json({ error: "The wiki database could not complete this request." }, 500);
  }
}
