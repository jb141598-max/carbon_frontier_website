import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";

const ROADMAP_STORE_NAME = "carbon-frontier-roadmap";
const ROADMAP_STORE_KEY = "shared-state";
const UPDATES_STORE_NAME = "carbon-frontier-updates";
const UPDATES_STORE_KEY = "shared-state";

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
    const [settingsResult, membersResult, pagesResult, revisionsResult] = await Promise.all([
      client.query(
        `SELECT visibility, editing_mode, updated_at, updated_by_email
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
           r.created_at AS revision_created_at
         FROM wiki_pages p
         LEFT JOIN wiki_revisions r ON r.id = p.current_revision_id
         WHERE p.is_deleted = FALSE
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
           WHERE p.is_deleted = FALSE
         )
         SELECT id, page_id, revision_number, page_title, content_json, edit_summary,
                author_email, author_name, author_role, created_at
         FROM ranked_revisions
         WHERE page_rank <= 25
         ORDER BY page_id, revision_number ASC`
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
        createdBy: page.created_by_email,
        updatedBy: page.updated_by_email,
        createdAt: isoDate(page.created_at),
        updatedAt: isoDate(page.updated_at),
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
        schemaVersion: 2,
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
