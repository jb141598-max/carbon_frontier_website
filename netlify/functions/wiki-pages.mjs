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

function normalizeCategories(value) {
  if (!Array.isArray(value)) return null;
  const unique = new Map();
  for (const item of value) {
    const name = normalizeTitle(item).slice(0, 80);
    const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    if (name && slug && !unique.has(slug)) unique.set(slug, { slug, name });
  }
  return [...unique.values()].slice(0, 20);
}

function categoriesFromRow(row) {
  let value = row.categories_json;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch (error) { value = []; }
  }
  return (Array.isArray(value) ? value : []).map((category) => ({
    id: String(category.id || ""),
    slug: String(category.slug || ""),
    name: String(category.name || ""),
  })).filter((category) => category.slug && category.name);
}

async function replacePageCategories(client, pageId, categories) {
  await client.query(`DELETE FROM wiki_page_categories WHERE page_id = $1`, [pageId]);
  for (const category of categories) {
    await client.query(
      `INSERT INTO wiki_categories (id, slug, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
      [crypto.randomUUID(), category.slug, category.name]
    );
    await client.query(
      `INSERT INTO wiki_page_categories (page_id, category_id)
       SELECT $1, id FROM wiki_categories WHERE slug = $2
       ON CONFLICT DO NOTHING`,
      [pageId, category.slug]
    );
  }
}

function pageFromRow(row, viewer) {
  const canEditThisPage =
    !row.is_deleted &&
    (viewer.isAssignedStaff || (viewer.canEdit && row.allow_normal_edits === true));
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    allowNormalEdits: row.allow_normal_edits,
    isDeleted: row.is_deleted === true,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    categories: categoriesFromRow(row),
    currentRevision: row.revision_id
      ? {
          id: row.revision_id,
          number: Number(row.revision_number),
          title: row.revision_title || row.title,
          content: row.content_json,
          editSummary: row.edit_summary,
          authorRole: row.author_role || "contributor",
          createdAt: new Date(row.revision_created_at).toISOString(),
        }
      : null,
    permissions: {
      canEdit: canEditThisPage,
      canChangePageSettings: viewer.isAssignedStaff,
      canRestoreRevisions: viewer.isAssignedStaff,
      canManagePage: viewer.isAssignedStaff,
      submitsForReview:
        canEditThisPage && !viewer.isAssignedStaff && viewer.reviewMode === "approval",
    },
  };
}

async function loadSecurity(client, account) {
  const state = await loadAccessState(client);
  const viewer = createViewer(state, account);
  viewer.reviewMode = state.reviewMode;
  viewer.isBlocked = false;
  viewer.blockReason = null;
  if (viewer.authenticated && !viewer.isAssignedStaff) {
    const blockedResult = await client.query(
      `SELECT reason FROM wiki_blocked_users WHERE email = $1`,
      [account.email]
    );
    if (blockedResult.rowCount) {
      viewer.isBlocked = true;
      viewer.blockReason = blockedResult.rows[0].reason || null;
      viewer.canEdit = false;
    }
  }
  return { state, viewer };
}

async function selectPage(client, slug, { lock = false, includeDeleted = false } = {}) {
  const result = await client.query(
    `SELECT
       p.id,
       p.slug,
       p.title,
       p.allow_normal_edits,
       p.is_deleted,
       p.deleted_at,
       p.created_at,
       p.updated_at,
       r.id AS revision_id,
       r.revision_number,
       r.page_title AS revision_title,
       r.content_json,
       r.edit_summary,
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
     WHERE p.slug = $1 AND ($2 = TRUE OR p.is_deleted = FALSE)
     ${lock ? "FOR UPDATE OF p" : ""}`,
    [slug, includeDeleted]
  );
  return result.rows[0] || null;
}

async function selectRedirectPage(client, sourceSlug) {
  const result = await client.query(
    `SELECT
       p.id,
       p.slug,
       p.title,
       p.allow_normal_edits,
       p.is_deleted,
       p.deleted_at,
       p.created_at,
       p.updated_at,
       r.id AS revision_id,
       r.revision_number,
       r.page_title AS revision_title,
       r.content_json,
       r.edit_summary,
       r.author_name,
       r.author_role,
       r.created_at AS revision_created_at,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name) ORDER BY c.name)
         FROM wiki_page_categories pc
         INNER JOIN wiki_categories c ON c.id = pc.category_id
         WHERE pc.page_id = p.id
       ), '[]'::jsonb) AS categories_json
     FROM wiki_redirects d
     INNER JOIN wiki_pages p ON p.id = d.target_page_id
     LEFT JOIN wiki_revisions r ON r.id = p.current_revision_id
     WHERE d.source_slug = $1 AND p.is_deleted = FALSE`,
    [sourceSlug]
  );
  return result.rows[0] || null;
}

async function handleGet(request, account) {
  const client = await db.pool.connect();
  try {
    const { state, viewer } = await loadSecurity(client, account);
    if (!viewer.canView) {
      return json({ error: "Wiki not available." }, 403);
    }

    const pageUrl = new URL(request.url);
    const slug = requestedSlug(request);
    if (!slug) {
      if (pageUrl.searchParams.get("trash") === "1") {
        if (!viewer.isAssignedStaff) {
          return json({ error: "Only assigned wiki staff can view the trash." }, 403);
        }
        const deletedResult = await client.query(
          `SELECT p.id, p.slug, p.title, p.allow_normal_edits, p.is_deleted,
                  p.deleted_at, p.created_at, p.updated_at,
                  r.id AS revision_id, r.revision_number,
                  r.page_title AS revision_title, r.content_json, r.edit_summary,
                  r.author_name, r.author_role, r.created_at AS revision_created_at
           FROM wiki_pages p
           LEFT JOIN wiki_revisions r ON r.id = p.current_revision_id
           WHERE p.is_deleted = TRUE
           ORDER BY p.deleted_at DESC NULLS LAST, p.updated_at DESC
           LIMIT 200`
        );
        return json({
          ok: true,
          pages: deletedResult.rows.map((row) => pageFromRow(row, viewer)),
          permissions: { canManageTrash: true },
        });
      }

      const search = String(pageUrl.searchParams.get("q") || "")
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
           r.author_name,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name) ORDER BY c.name)
             FROM wiki_page_categories pc
             INNER JOIN wiki_categories c ON c.id = pc.category_id
             WHERE pc.page_id = p.id
           ), '[]'::jsonb) AS categories_json
         FROM wiki_pages p
         LEFT JOIN wiki_revisions r ON r.id = p.current_revision_id
         WHERE p.is_deleted = FALSE
           AND ($1 = '' OR p.title ILIKE $2 ESCAPE '\\' OR p.slug ILIKE $2 ESCAPE '\\')
         ORDER BY p.updated_at DESC, p.title ASC
         LIMIT 250`,
        [search, searchPattern]
      );
      const redirects = await client.query(
        `SELECT d.source_slug, p.slug AS target_slug, p.title AS target_title
         FROM wiki_redirects d
         INNER JOIN wiki_pages p ON p.id = d.target_page_id
         WHERE p.is_deleted = FALSE
         ORDER BY d.source_slug ASC
         LIMIT 250`
      );
      return json({
        ok: true,
        query: search,
        permissions: {
          canCreate: viewer.canEdit,
          isAssignedStaff: viewer.isAssignedStaff,
          canManageTrash: viewer.isAssignedStaff,
          submitsForReview:
            viewer.canEdit && !viewer.isAssignedStaff && state.reviewMode === "approval",
        },
        pages: result.rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          allowNormalEdits: row.allow_normal_edits,
          updatedAt: new Date(row.updated_at).toISOString(),
          revisionNumber: row.revision_number ? Number(row.revision_number) : null,
          editSummary: row.edit_summary || "",
          categories: categoriesFromRow(row),
        })),
        redirects: redirects.rows.map((row) => ({
          sourceSlug: row.source_slug,
          targetSlug: row.target_slug,
          targetTitle: row.target_title,
        })),
      });
    }

    if (!validateSlug(slug)) {
      return json({ error: "That wiki page address is invalid." }, 400);
    }
    let pageRow = await selectPage(client, slug);
    let redirect = null;
    if (!pageRow) {
      pageRow = await selectRedirectPage(client, slug);
      if (pageRow) {
        redirect = { sourceSlug: slug, targetSlug: pageRow.slug };
      }
    }
    if (!pageRow) {
      return json({ error: "Wiki page not found." }, 404);
    }

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
        redirect,
        revisions: revisions.rows.map((row) => ({
          id: row.id,
          number: Number(row.revision_number),
          title: row.page_title,
          editSummary: row.edit_summary,
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
        redirect,
        revision: {
          id: revision.id,
          number: Number(revision.revision_number),
          title: revision.page_title,
          content: revision.content_json,
          editSummary: revision.edit_summary,
          authorRole: revision.author_role || "contributor",
          createdAt: new Date(revision.created_at).toISOString(),
          isCurrent: revision.id === pageRow.revision_id,
        },
      });
    }

    return json({ ok: true, page: pageFromRow(pageRow, viewer), redirect });
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
      return json(
        {
          error: viewer.isBlocked
            ? "This account is blocked from contributing to the wiki."
            : "This account cannot create wiki pages.",
        },
        403
      );
    }

    const addressConflict = await client.query(
      `SELECT 1 FROM wiki_pages WHERE slug = $1
       UNION ALL
       SELECT 1 FROM wiki_redirects WHERE source_slug = $1
       LIMIT 1`,
      [slug]
    );
    if (addressConflict.rowCount) {
      return json({ error: "That page address is already in use." }, 409);
    }

    if (!viewer.isAssignedStaff && state.reviewMode === "approval") {
      const conflict = await client.query(
        `SELECT 1 FROM wiki_pending_edits
         WHERE requested_slug = $1 AND submission_type = 'create' AND status = 'pending'
         LIMIT 1`,
        [slug]
      );
      if (conflict.rowCount) {
        return json({ error: "That page address is already in use or awaiting review." }, 409);
      }
      const submissionId = crypto.randomUUID();
      await client.query(
        `INSERT INTO wiki_pending_edits (
           id, submission_type, requested_slug, page_title, content_json,
           edit_summary, author_email, author_name
         ) VALUES ($1, 'create', $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          submissionId,
          slug,
          title,
          contentResult.serialized,
          editSummary,
          account.email,
          account.name || null,
        ]
      );
      await insertAuditEntry(client, {
        action: "page_edit_submitted",
        actorEmail: account.email,
        details: { submissionId, submissionType: "create", slug, title },
      });
      await client.query("COMMIT");
      committed = true;
      return json(
        {
          ok: true,
          pendingReview: true,
          submission: { id: submissionId, type: "create", slug, title },
        },
        202
      );
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
    const restoringFromTrash = body?.action === "restore_from_trash";
    const pageRow = await selectPage(client, slug, {
      lock: true,
      includeDeleted: restoringFromTrash,
    });
    if (!pageRow) {
      return json({ error: "Wiki page not found." }, 404);
    }

    if (body?.action === "move_page") {
      if (!viewer.isAssignedStaff) {
        return json({ error: "Only assigned wiki staff can move pages." }, 403);
      }
      if (pageRow.slug === "front-page") {
        return json({ error: "The wiki front page address cannot be moved." }, 400);
      }
      const newSlug = normalizeSlug(body?.newSlug);
      if (!validateSlug(newSlug)) {
        return json({ error: "Use a lowercase page address with words separated by hyphens." }, 400);
      }
      if (newSlug === pageRow.slug) {
        return json({ error: "Enter a different page address before moving." }, 400);
      }
      const conflict = await client.query(
        `SELECT 1 FROM wiki_pages WHERE slug = $1
         UNION ALL
         SELECT 1 FROM wiki_redirects WHERE source_slug = $1
         LIMIT 1`,
        [newSlug]
      );
      if (conflict.rowCount) {
        return json({ error: "That page address is already in use." }, 409);
      }

      const oldSlug = pageRow.slug;
      await client.query(
        `UPDATE wiki_pages
         SET slug = $1, updated_at = NOW(), updated_by_email = $2
         WHERE id = $3`,
        [newSlug, account.email, pageRow.id]
      );
      await client.query(
        `INSERT INTO wiki_redirects (source_slug, target_page_id, created_by_email)
         VALUES ($1, $2, $3)
         ON CONFLICT (source_slug) DO UPDATE
         SET target_page_id = EXCLUDED.target_page_id,
             created_by_email = EXCLUDED.created_by_email,
             created_at = NOW()`,
        [oldSlug, pageRow.id, account.email]
      );
      await insertAuditEntry(client, {
        action: "page_moved",
        actorEmail: account.email,
        pageId: pageRow.id,
        details: { oldSlug, newSlug, redirectCreated: true },
      });
      await client.query("COMMIT");
      committed = true;
      const moved = await selectPage(client, newSlug);
      return json({
        ok: true,
        page: pageFromRow(moved, viewer),
        moved: { oldSlug, newSlug, redirectCreated: true },
      });
    }

    if (body?.action === "trash_page") {
      if (!viewer.isAssignedStaff) {
        return json({ error: "Only assigned wiki staff can move pages to trash." }, 403);
      }
      if (pageRow.slug === "front-page") {
        return json({ error: "The wiki front page cannot be moved to trash." }, 400);
      }
      await client.query(
        `UPDATE wiki_pages
         SET is_deleted = TRUE,
             deleted_at = NOW(),
             deleted_by_email = $1,
             updated_at = NOW(),
             updated_by_email = $1
         WHERE id = $2`,
        [account.email, pageRow.id]
      );
      await insertAuditEntry(client, {
        action: "page_trashed",
        actorEmail: account.email,
        pageId: pageRow.id,
        details: { slug: pageRow.slug, title: pageRow.title },
      });
      await client.query("COMMIT");
      committed = true;
      return json({ ok: true, trashed: { slug: pageRow.slug, title: pageRow.title } });
    }

    if (body?.action === "restore_from_trash") {
      if (!viewer.isAssignedStaff) {
        return json({ error: "Only assigned wiki staff can restore trashed pages." }, 403);
      }
      if (!pageRow.is_deleted) {
        return json({ error: "That page is not in the trash." }, 400);
      }
      await client.query(
        `UPDATE wiki_pages
         SET is_deleted = FALSE,
             deleted_at = NULL,
             deleted_by_email = NULL,
             updated_at = NOW(),
             updated_by_email = $1
         WHERE id = $2`,
        [account.email, pageRow.id]
      );
      await insertAuditEntry(client, {
        action: "page_restored_from_trash",
        actorEmail: account.email,
        pageId: pageRow.id,
        details: { slug: pageRow.slug, title: pageRow.title },
      });
      await client.query("COMMIT");
      committed = true;
      const restoredPage = await selectPage(client, pageRow.slug);
      return json({ ok: true, page: pageFromRow(restoredPage, viewer) });
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

    if (body?.action === "update_page_categories") {
      if (!viewer.isAssignedStaff) {
        return json({ error: "Only assigned wiki staff can organize page categories." }, 403);
      }
      const categories = normalizeCategories(body?.categories);
      if (!categories) {
        return json({ error: "Send categories as a list of names." }, 400);
      }
      await replacePageCategories(client, pageRow.id, categories);
      await insertAuditEntry(client, {
        action: "page_categories_changed",
        actorEmail: account.email,
        pageId: pageRow.id,
        details: { categories: categories.map((category) => category.name) },
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
      return json(
        {
          error: viewer.isBlocked
            ? "This account is blocked from contributing to the wiki."
            : "Editing is disabled for this page.",
        },
        403
      );
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

    if (!viewer.isAssignedStaff && state.reviewMode === "approval") {
      const submissionId = crypto.randomUUID();
      await client.query(
        `INSERT INTO wiki_pending_edits (
           id, submission_type, page_id, requested_slug, page_title,
           base_revision_id, content_json, edit_summary, author_email, author_name
         ) VALUES ($1, 'edit', $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [
          submissionId,
          pageRow.id,
          pageRow.slug,
          title,
          pageRow.revision_id,
          contentResult.serialized,
          editSummary,
          account.email,
          account.name || null,
        ]
      );
      await insertAuditEntry(client, {
        action: "page_edit_submitted",
        actorEmail: account.email,
        pageId: pageRow.id,
        details: {
          submissionId,
          submissionType: "edit",
          slug: pageRow.slug,
          title,
          baseRevisionId: pageRow.revision_id,
        },
      });
      await client.query("COMMIT");
      committed = true;
      return json(
        {
          ok: true,
          pendingReview: true,
          submission: {
            id: submissionId,
            type: "edit",
            slug: pageRow.slug,
            title,
          },
          page: pageFromRow(pageRow, viewer),
        },
        202
      );
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
    if (error?.code === "23505") {
      return json({ error: "That wiki page address is already in use." }, 409);
    }
    console.error("wiki-pages failed", error);
    return json({ error: "The wiki database could not complete this request." }, 500);
  }
}
