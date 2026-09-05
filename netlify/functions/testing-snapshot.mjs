import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";

const ROADMAP_STORE_NAME = "carbon-frontier-roadmap";
const ROADMAP_STORE_KEY = "shared-state";
const UPDATES_STORE_NAME = "carbon-frontier-updates";
const UPDATES_STORE_KEY = "shared-state";
const WIKI_MEDIA_STORE_NAME = "carbon-frontier-wiki-media";

export const config = {
  path: "/api/testing-snapshot",
};

function getEnvironmentValue(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || "";
}

function constantTimeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""), "utf8");
  const right = Buffer.from(String(rightValue || ""), "utf8");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function allowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return "";
  }
  if (origin === "null") {
    return "null";
  }

  try {
    const parsedOrigin = new URL(origin);
    const requestOrigin = new URL(request.url).origin;
    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
    if (parsedOrigin.origin === requestOrigin) {
      return parsedOrigin.origin;
    }
    if (["http:", "https:"].includes(parsedOrigin.protocol) && localHosts.has(parsedOrigin.hostname)) {
      return parsedOrigin.origin;
    }
    if (
      parsedOrigin.hostname.toLowerCase().includes("cursor") ||
      parsedOrigin.hostname.toLowerCase().includes("vscode")
    ) {
      return parsedOrigin.origin;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function responseHeaders(origin) {
  const headers = {
    "access-control-allow-headers": "content-type, x-testing-sync-key",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-max-age": "600",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
    "x-content-type-options": "nosniff",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(origin),
  });
}

function isoDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function loadWikiMediaData(id) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(String(id || ""))) return null;
  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    const result = await client.query(
      `SELECT blob_key, content_type, size_bytes FROM wiki_media WHERE id = $1`,
      [id]
    );
    if (!result.rowCount) return null;
    const media = result.rows[0];
    const data = await getStore({ name: WIKI_MEDIA_STORE_NAME, consistency: "strong" })
      .get(media.blob_key, { type: "arrayBuffer" });
    return data ? { data, contentType: media.content_type, sizeBytes: Number(media.size_bytes) } : null;
  } finally { client.release(); }
}

async function loadBlobSnapshot() {
  const [roadmap, updates] = await Promise.all([
    getStore({ name: ROADMAP_STORE_NAME, consistency: "strong" }).get(ROADMAP_STORE_KEY, {
      type: "json",
    }),
    getStore({ name: UPDATES_STORE_NAME, consistency: "strong" }).get(UPDATES_STORE_KEY, {
      type: "json",
    }),
  ]);

  return {
    roadmap: {
      exists: Boolean(roadmap),
      cards: Array.isArray(roadmap?.cards) ? roadmap.cards : [],
      orderMode: roadmap?.orderMode === "manual" ? "manual" : "date",
    },
    updates: {
      exists: Boolean(updates),
      updates: Array.isArray(updates?.updates)
        ? updates.updates
        : Array.isArray(updates?.rows)
          ? updates.rows
          : [],
    },
  };
}

async function loadWikiSnapshot() {
  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    const [
      settingsResult,
      membersResult,
      pagesResult,
      revisionsResult,
      redirectsResult,
      pendingResult,
      blocksResult,
      auditResult,
      templatesResult,
      mediaResult,
    ] = await Promise.all([
      client.query(
        `SELECT visibility, editing_mode, review_mode, updated_at, updated_by_email
         FROM wiki_settings
         WHERE id = 1`
      ),
      client.query(
        `SELECT email, role, assigned_at, assigned_by_email
         FROM wiki_members
         ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, email`
      ),
      client.query(
        `SELECT
           p.id,
           p.slug,
           p.title,
           p.allow_normal_edits,
           p.is_deleted,
           p.deleted_at,
           p.created_by_email,
           p.updated_by_email,
           p.created_at,
           p.updated_at,
           r.id AS revision_id,
           r.revision_number,
           r.page_title AS revision_title,
           r.content_json,
           r.edit_summary,
           r.author_email,
           r.author_name,
           r.author_role,
           r.created_at AS revision_created_at,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name) ORDER BY c.name)
             FROM wiki_page_categories pc
             INNER JOIN wiki_categories c ON c.id = pc.category_id
             WHERE pc.page_id = p.id
           ), '[]'::jsonb) AS categories_json
         FROM wiki_pages p
         LEFT JOIN wiki_revisions r ON r.id = p.current_revision_id
         ORDER BY p.updated_at DESC`
      ),
      client.query(
        `WITH ranked_revisions AS (
           SELECT
             r.id,
             r.page_id,
             r.revision_number,
             r.page_title,
             r.content_json,
             r.edit_summary,
             r.author_email,
             r.author_name,
             r.author_role,
             r.created_at,
             ROW_NUMBER() OVER (
               PARTITION BY r.page_id
               ORDER BY r.revision_number DESC
             ) AS page_rank
           FROM wiki_revisions r
           INNER JOIN wiki_pages p ON p.id = r.page_id
         )
         SELECT id, page_id, revision_number, page_title, content_json, edit_summary,
                author_email, author_name, author_role, created_at
         FROM ranked_revisions
         WHERE page_rank <= 25
         ORDER BY page_id, revision_number ASC`
      ),
      client.query(
        `SELECT d.source_slug, p.slug AS target_slug
         FROM wiki_redirects d
         INNER JOIN wiki_pages p ON p.id = d.target_page_id
         WHERE p.is_deleted = FALSE
         ORDER BY d.created_at DESC`
      ),
      client.query(
        `SELECT pe.*, r.revision_number AS base_revision_number
         FROM wiki_pending_edits pe
         LEFT JOIN wiki_revisions r ON r.id = pe.base_revision_id
         WHERE pe.status = 'pending'
         ORDER BY pe.created_at ASC
         LIMIT 200`
      ),
      client.query(
        `SELECT email, reason, blocked_by_email, blocked_at
         FROM wiki_blocked_users
         ORDER BY blocked_at DESC
         LIMIT 200`
      ),
      client.query(
        `SELECT a.id, a.action, a.actor_email, a.target_email, a.page_id,
                a.details_json, a.created_at, p.title AS page_title, p.slug AS page_slug
         FROM wiki_audit_log a
         LEFT JOIN wiki_pages p ON p.id = a.page_id
         ORDER BY a.created_at DESC
         LIMIT 150`
      ),
      client.query(
        `SELECT t.id, t.slug, t.name, t.description, t.canvas_width, t.canvas_height,
                t.created_at, t.updated_at,
                r.id AS revision_id, r.revision_number, r.definition_json,
                r.edit_summary, r.author_name, r.author_role, r.created_at AS revision_created_at
         FROM wiki_templates t
         LEFT JOIN wiki_template_revisions r ON r.id = t.current_revision_id
         WHERE t.is_deleted = FALSE
         ORDER BY t.updated_at DESC, t.name ASC
         LIMIT 250`
      ),
      client.query(
        `SELECT id, original_name, description, alt_text, default_caption, tags, credit,
                source_url, content_type, size_bytes, uploaded_at, updated_at
         FROM wiki_media
         ORDER BY uploaded_at DESC
         LIMIT 500`
      ),
    ]);

    const settings = settingsResult.rows[0] || {};
    const revisionsByPage = new Map();
    revisionsResult.rows.forEach((revision) => {
      const history = revisionsByPage.get(revision.page_id) || [];
      history.push({
        id: revision.id,
        number: Number(revision.revision_number),
        title: revision.page_title,
        content: revision.content_json,
        editSummary: revision.edit_summary,
        authorEmail: revision.author_email,
        authorName: revision.author_name || null,
        authorRole: revision.author_role || "contributor",
        createdAt: isoDate(revision.created_at),
      });
      revisionsByPage.set(revision.page_id, history);
    });
    return {
      available: true,
      settings: {
        visibility: settings.visibility === "public" ? "public" : "private",
        editingMode: settings.editing_mode === "open" ? "open" : "restricted",
        reviewMode: settings.review_mode === "approval" ? "approval" : "immediate",
        updatedAt: isoDate(settings.updated_at),
        updatedBy: settings.updated_by_email || null,
      },
      members: membersResult.rows.map((member) => ({
        email: member.email,
        role: member.role,
        assignedAt: isoDate(member.assigned_at),
        assignedBy: member.assigned_by_email,
      })),
      pages: pagesResult.rows.map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        allowNormalEdits: page.allow_normal_edits,
        isDeleted: page.is_deleted === true,
        deletedAt: isoDate(page.deleted_at),
        createdBy: page.created_by_email,
        updatedBy: page.updated_by_email,
        createdAt: isoDate(page.created_at),
        updatedAt: isoDate(page.updated_at),
        categories: Array.isArray(page.categories_json) ? page.categories_json : [],
        currentRevision: page.revision_id
          ? {
              id: page.revision_id,
              number: Number(page.revision_number),
              title: page.revision_title || page.title,
              content: page.content_json,
              editSummary: page.edit_summary,
              authorEmail: page.author_email,
              authorName: page.author_name || null,
              authorRole: page.author_role || "contributor",
              createdAt: isoDate(page.revision_created_at),
            }
          : null,
        localRevisions: revisionsByPage.get(page.id) || [],
      })),
      redirects: redirectsResult.rows.map((redirect) => ({
        sourceSlug: redirect.source_slug,
        targetSlug: redirect.target_slug,
      })),
      templates: templatesResult.rows.map((template) => {
        const definition = template.definition_json;
        const seen = new Set();
        const placeholders = [];
        (Array.isArray(definition?.elements) ? definition.elements : []).forEach((element) => {
          if (!["placeholder", "image-placeholder"].includes(element?.type) || !element.placeholderKey || seen.has(element.placeholderKey)) return;
          seen.add(element.placeholderKey);
          placeholders.push({
            key: element.placeholderKey,
            label: String(element.placeholderKey).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
            kind: element.type === "image-placeholder" ? "image" : "text",
            defaultValue: element.type === "placeholder" ? element.defaultValue || "" : "",
            defaultAlt: element.type === "image-placeholder" ? element.defaultAlt || "" : "",
          });
        });
        return {
          id: template.id,
          slug: template.slug,
          name: template.name,
          description: template.description || "",
          canvas: { width: Number(template.canvas_width), height: Number(template.canvas_height) },
          createdAt: isoDate(template.created_at),
          updatedAt: isoDate(template.updated_at),
          currentRevision: template.revision_id ? {
            id: template.revision_id,
            number: Number(template.revision_number),
            definition,
            editSummary: template.edit_summary || "",
            authorName: template.author_name || null,
            authorRole: template.author_role || "wiki_editor",
            createdAt: isoDate(template.revision_created_at),
          } : null,
          placeholders,
          permissions: { canEdit: true, canDelete: true },
        };
      }),
      media: mediaResult.rows.map((item) => ({
        id: item.id,
        originalName: item.original_name,
        title: item.original_name,
        description: item.description || "",
        altText: item.alt_text || "",
        defaultCaption: item.default_caption || "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        credit: item.credit || "",
        sourceUrl: item.source_url || "",
        contentType: item.content_type,
        sizeBytes: Number(item.size_bytes),
        uploadedAt: isoDate(item.uploaded_at),
        updatedAt: isoDate(item.updated_at),
        uploadedByLabel: "Wiki contributor",
        canEditMetadata: true,
        url: `/api/wiki/media/${encodeURIComponent(item.id)}`,
      })),
      moderation: {
        pendingEdits: pendingResult.rows.map((submission) => ({
          id: submission.id,
          type: submission.submission_type,
          pageId: submission.page_id || null,
          slug: submission.requested_slug,
          title: submission.page_title,
          baseRevisionId: submission.base_revision_id || null,
          baseRevisionNumber: submission.base_revision_number
            ? Number(submission.base_revision_number)
            : null,
          content: submission.content_json,
          editSummary: submission.edit_summary || "",
          authorEmail: submission.author_email,
          authorName: submission.author_name || null,
          status: submission.status,
          createdAt: isoDate(submission.created_at),
        })),
        blockedUsers: blocksResult.rows.map((blocked) => ({
          email: blocked.email,
          reason: blocked.reason || "",
          blockedBy: blocked.blocked_by_email,
          blockedAt: isoDate(blocked.blocked_at),
        })),
        activity: auditResult.rows.map((entry) => ({
          id: entry.id,
          action: entry.action,
          actorEmail: entry.actor_email,
          targetEmail: entry.target_email || null,
          pageId: entry.page_id || null,
          pageTitle: entry.page_title || null,
          pageSlug: entry.page_slug || null,
          details: entry.details_json && typeof entry.details_json === "object"
            ? entry.details_json
            : {},
          createdAt: isoDate(entry.created_at),
        })),
      },
    };
  } finally {
    client.release();
  }
}

export default async function handler(request) {
  const origin = allowedOrigin(request);
  if (origin === null) {
    return json({ error: "This testing connection is only available to local Cursor previews." }, 403, "");
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405, origin);
  }

  const configuredKey = getEnvironmentValue("CURSOR_TESTING_SYNC_KEY");
  if (!configuredKey) {
    return json(
      { error: "CURSOR_TESTING_SYNC_KEY has not been configured on Netlify yet." },
      503,
      origin
    );
  }
  if (!constantTimeEqual(request.headers.get("x-testing-sync-key"), configuredKey)) {
    return json({ error: "The Cursor testing sync key is incorrect." }, 401, origin);
  }

  const requestedMedia = new URL(request.url).searchParams.get("media");
  if (requestedMedia) {
    try {
      const media = await loadWikiMediaData(requestedMedia);
      if (!media) return json({ error: "Wiki image not found." }, 404, origin);
      return new Response(media.data, {
        status: 200,
        headers: {
          ...responseHeaders(origin),
          "content-type": media.contentType,
          "content-length": String(media.sizeBytes),
          "content-disposition": "inline",
        },
      });
    } catch {
      return json({ error: "The live wiki image could not be loaded." }, 500, origin);
    }
  }

  try {
    const [{ roadmap, updates }, wikiResult] = await Promise.all([
      loadBlobSnapshot(),
      loadWikiSnapshot().catch(() => ({
        available: false,
        settings: null,
        members: [],
        pages: [],
        error: "Wiki database data is not available yet.",
      })),
    ]);

    return json(
      {
        schemaVersion: 6,
        generatedAt: new Date().toISOString(),
        sourceOrigin: new URL(request.url).origin,
        roadmap,
        updates,
        wiki: wikiResult,
      },
      200,
      origin
    );
  } catch (error) {
    return json({ error: "The live testing copy could not be created." }, 500, origin);
  }
}
