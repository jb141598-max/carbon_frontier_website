import { getDatabase } from "@netlify/database";
import {
  createViewer,
  json,
  loadAccessState,
  verifyGoogleRequest,
} from "./_shared/wiki-security.mjs";

const db = getDatabase();

export const config = {
  path: "/api/wiki/backup",
};

function number(value) {
  return Number(value) || 0;
}

function camelKey(value) {
  return String(value).replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function cleanRows(rows) {
  return (rows || []).map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelKey(key), value])
  ));
}

async function readiness(client, state) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM wiki_pages WHERE is_deleted = FALSE)::INTEGER AS pages,
       (SELECT COUNT(*) FROM wiki_revisions)::INTEGER AS revisions,
       (SELECT COUNT(*) FROM wiki_templates WHERE is_deleted = FALSE)::INTEGER AS templates,
       (SELECT COUNT(*) FROM wiki_template_revisions)::INTEGER AS template_revisions,
       (SELECT COUNT(*) FROM wiki_media)::INTEGER AS media,
       (SELECT COUNT(*) FROM wiki_pending_edits WHERE status = 'pending')::INTEGER AS pending_edits,
       (SELECT COUNT(*) FROM wiki_pages WHERE is_deleted = FALSE AND current_revision_id IS NULL)::INTEGER AS pages_without_revision,
       (SELECT COUNT(*) FROM wiki_templates WHERE is_deleted = FALSE AND current_revision_id IS NULL)::INTEGER AS templates_without_revision,
       (SELECT COUNT(*) FROM wiki_redirects r
          LEFT JOIN wiki_pages p ON p.id = r.target_page_id
          WHERE p.id IS NULL OR p.is_deleted = TRUE)::INTEGER AS broken_redirects,
       (SELECT COUNT(*) FROM wiki_pages
          WHERE slug = 'front-page' AND is_deleted = FALSE AND current_revision_id IS NOT NULL)::INTEGER AS front_page_ready`
  );
  const counts = result.rows[0] || {};
  const owners = state.members.filter((member) => member.role === "owner").length;
  const pagesWithoutRevision = number(counts.pages_without_revision);
  const templatesWithoutRevision = number(counts.templates_without_revision);
  const brokenRedirects = number(counts.broken_redirects);
  const pendingEdits = number(counts.pending_edits);
  const frontPageReady = number(counts.front_page_ready) > 0;
  const checks = [
    {
      status: owners > 0 ? "pass" : "fail",
      label: owners > 0 ? `${owners} Owner account${owners === 1 ? "" : "s"} assigned` : "No Owner account is assigned",
      detail: owners > 0 ? "At least one Owner can manage permissions and recovery." : "Assign an Owner before launch.",
    },
    {
      status: frontPageReady ? "pass" : "fail",
      label: "Wiki front page",
      detail: frontPageReady ? "The front page exists and has saved content." : "The active front page or its current revision is missing.",
    },
    {
      status: pagesWithoutRevision ? "fail" : "pass",
      label: "Page revision links",
      detail: pagesWithoutRevision ? `${pagesWithoutRevision} active page${pagesWithoutRevision === 1 ? " has" : "s have"} no current revision.` : "Every active page has a current revision.",
    },
    {
      status: templatesWithoutRevision ? "fail" : "pass",
      label: "Template revision links",
      detail: templatesWithoutRevision ? `${templatesWithoutRevision} active template${templatesWithoutRevision === 1 ? " has" : "s have"} no current revision.` : "Every active template has a current revision.",
    },
    {
      status: brokenRedirects ? "fail" : "pass",
      label: "Redirect targets",
      detail: brokenRedirects ? `${brokenRedirects} redirect${brokenRedirects === 1 ? " points" : "s point"} to a missing or deleted page.` : "Every redirect points to an active page.",
    },
    {
      status: pendingEdits ? "warning" : "pass",
      label: "Moderation queue",
      detail: pendingEdits ? `${pendingEdits} pending edit${pendingEdits === 1 ? " needs" : "s need"} review before launch.` : "No edits are waiting for review.",
    },
  ];
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      pages: number(counts.pages),
      revisions: number(counts.revisions),
      templates: number(counts.templates),
      templateRevisions: number(counts.template_revisions),
      media: number(counts.media),
    },
    settings: {
      visibility: state.visibility,
      editingMode: state.editingMode,
      reviewMode: state.reviewMode,
    },
    checks,
  };
}

async function fullBackup(client) {
  const [
    settings, members, pages, revisions, categories, pageCategories, redirects,
    media, pendingEdits, blockedUsers, templates, templateRevisions, auditLog,
  ] = await Promise.all([
    client.query("SELECT * FROM wiki_settings ORDER BY id"),
    client.query("SELECT * FROM wiki_members ORDER BY role, email"),
    client.query("SELECT * FROM wiki_pages ORDER BY created_at, id"),
    client.query("SELECT * FROM wiki_revisions ORDER BY page_id, revision_number"),
    client.query("SELECT * FROM wiki_categories ORDER BY name, id"),
    client.query("SELECT * FROM wiki_page_categories ORDER BY page_id, category_id"),
    client.query(
      `SELECT r.source_slug, r.target_page_id, p.slug AS target_slug,
              r.created_by_email, r.created_at
       FROM wiki_redirects r
       LEFT JOIN wiki_pages p ON p.id = r.target_page_id
       ORDER BY r.source_slug`
    ),
    client.query("SELECT * FROM wiki_media ORDER BY uploaded_at, id"),
    client.query("SELECT * FROM wiki_pending_edits ORDER BY created_at, id"),
    client.query("SELECT * FROM wiki_blocked_users ORDER BY blocked_at, email"),
    client.query("SELECT * FROM wiki_templates ORDER BY created_at, id"),
    client.query("SELECT * FROM wiki_template_revisions ORDER BY template_id, revision_number"),
    client.query("SELECT * FROM wiki_audit_log ORDER BY created_at DESC LIMIT 5000"),
  ]);

  return {
    ok: true,
    exportType: "carbon-frontier-wiki-backup",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: "production",
    warning: "This private backup includes member emails and content metadata. Image binary files remain in Netlify Blobs; wiki_media includes the blob keys needed for recovery.",
    data: {
      settings: cleanRows(settings.rows)[0] || null,
      members: cleanRows(members.rows),
      pages: cleanRows(pages.rows),
      revisions: cleanRows(revisions.rows),
      categories: cleanRows(categories.rows),
      pageCategories: cleanRows(pageCategories.rows),
      redirects: cleanRows(redirects.rows),
      media: cleanRows(media.rows),
      pendingEdits: cleanRows(pendingEdits.rows),
      blockedUsers: cleanRows(blockedUsers.rows),
      templates: cleanRows(templates.rows),
      templateRevisions: cleanRows(templateRevisions.rows),
      auditLog: cleanRows(auditLog.rows),
    },
  };
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  const auth = await verifyGoogleRequest(request);
  if (!auth.ok) return json({ error: auth.message }, auth.status);

  const client = await db.pool.connect();
  try {
    const state = await loadAccessState(client);
    const viewer = createViewer(state, auth.account);
    if (!viewer.canManageSettings) {
      return json({ error: "Only wiki owners and admins can create launch reports and backups." }, 403);
    }
    const mode = new URL(request.url).searchParams.get("mode") === "readiness" ? "readiness" : "full";
    return json(mode === "readiness" ? await readiness(client, state) : await fullBackup(client));
  } catch (error) {
    console.error("wiki-backup failed", error);
    return json({ error: "The wiki backup could not be generated." }, 500);
  } finally {
    client.release();
  }
}
