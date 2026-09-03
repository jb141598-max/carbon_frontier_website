import { getDatabase } from "@netlify/database";
import {
  createViewer,
  json,
  loadAccessState,
  normalizeEmail,
  verifyGoogleRequest,
} from "./_shared/wiki-security.mjs";

const db = getDatabase();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SCOPES = new Set(["all_editors", "assigned_staff"]);
const ROLE_ORDER = new Map([
  ["owner", 0],
  ["admin", 1],
  ["wiki_editor", 2],
  ["contributor", 3],
]);

export const config = {
  path: "/api/wiki/analytics",
};

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function defaultDates() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start: dateString(start), end: dateString(end) };
}

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && dateString(parsed) === value;
}

function roleLabel(role) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "wiki_editor") return "Wiki Editor";
  return "Contributor";
}

function normalizeRange(url) {
  const defaults = defaultDates();
  const start = String(url.searchParams.get("start") || defaults.start).trim();
  const end = String(url.searchParams.get("end") || defaults.end).trim();
  if (!isValidDate(start) || !isValidDate(end)) {
    return { ok: false, message: "Choose valid start and end dates." };
  }
  if (start > end) {
    return { ok: false, message: "The start date must be before or equal to the end date." };
  }
  return { ok: true, start, end };
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  const auth = await verifyGoogleRequest(request);
  if (!auth.ok) {
    return json({ error: auth.message }, auth.status);
  }

  const url = new URL(request.url);
  const range = normalizeRange(url);
  if (!range.ok) {
    return json({ error: range.message }, 400);
  }

  const client = await db.pool.connect();
  try {
    const state = await loadAccessState(client);
    const viewer = createViewer(state, auth.account);
    if (!viewer.canManageSettings) {
      return json({ error: "Only wiki owners and admins can view contributor analytics." }, 403);
    }

    const defaultScope =
      state.visibility === "public" && state.editingMode === "open"
        ? "all_editors"
        : "assigned_staff";
    const requestedScope = String(url.searchParams.get("scope") || defaultScope).trim();
    const scope = VALID_SCOPES.has(requestedScope) ? requestedScope : defaultScope;
    const staffByEmail = new Map(
      state.members.map((member) => [normalizeEmail(member.email), member])
    );
    const assignedEmails = [...staffByEmail.keys()];

    const [revisionStatsResult, createdStatsResult, topPagesResult] = await Promise.all([
      client.query(
        `SELECT
           author_email,
           (ARRAY_AGG(NULLIF(author_name, '') ORDER BY created_at DESC)
             FILTER (WHERE NULLIF(author_name, '') IS NOT NULL))[1] AS author_name,
           COUNT(*)::INTEGER AS edits,
           COUNT(DISTINCT page_id)::INTEGER AS pages_edited,
           MAX(created_at) AS last_edit_at
         FROM wiki_revisions
         WHERE created_at >= $1::DATE
           AND created_at < ($2::DATE + INTERVAL '1 day')
           AND author_email <> 'system'
         GROUP BY author_email`,
        [range.start, range.end]
      ),
      client.query(
        `SELECT created_by_email, COUNT(*)::INTEGER AS pages_created
         FROM wiki_pages
         WHERE created_at >= $1::DATE
           AND created_at < ($2::DATE + INTERVAL '1 day')
           AND created_by_email <> 'system'
         GROUP BY created_by_email`,
        [range.start, range.end]
      ),
      client.query(
        `SELECT
           p.id,
           p.slug,
           p.title,
           p.is_deleted,
           COUNT(*)::INTEGER AS edits
         FROM wiki_revisions r
         INNER JOIN wiki_pages p ON p.id = r.page_id
         WHERE r.created_at >= $1::DATE
           AND r.created_at < ($2::DATE + INTERVAL '1 day')
           AND r.author_email <> 'system'
           AND ($3 = 'all_editors' OR r.author_email = ANY($4::TEXT[]))
         GROUP BY p.id, p.slug, p.title, p.is_deleted
         ORDER BY edits DESC, p.title ASC
         LIMIT 20`,
        [range.start, range.end, scope, assignedEmails]
      ),
    ]);

    const statsByEmail = new Map();
    revisionStatsResult.rows.forEach((row) => {
      const email = normalizeEmail(row.author_email);
      statsByEmail.set(email, {
        email,
        authorName: String(row.author_name || "").trim() || null,
        edits: Number(row.edits) || 0,
        pagesEdited: Number(row.pages_edited) || 0,
        pagesCreated: 0,
        lastEditAt: row.last_edit_at ? new Date(row.last_edit_at).toISOString() : null,
      });
    });
    createdStatsResult.rows.forEach((row) => {
      const email = normalizeEmail(row.created_by_email);
      const existing = statsByEmail.get(email) || {
        email,
        authorName: null,
        edits: 0,
        pagesEdited: 0,
        pagesCreated: 0,
        lastEditAt: null,
      };
      existing.pagesCreated = Number(row.pages_created) || 0;
      statsByEmail.set(email, existing);
    });

    const includedEmails = new Set(assignedEmails);
    if (scope === "all_editors") {
      statsByEmail.forEach((stats, email) => {
        if (stats.edits > 0) includedEmails.add(email);
      });
    }

    const contributors = [...includedEmails]
      .map((email) => {
        const member = staffByEmail.get(email);
        const stats = statsByEmail.get(email) || {
          authorName: null,
          edits: 0,
          pagesEdited: 0,
          pagesCreated: 0,
          lastEditAt: null,
        };
        const role = member?.role || "contributor";
        return {
          email,
          displayName: stats.authorName || roleLabel(role),
          role,
          isAssignedStaff: Boolean(member),
          edits: stats.edits,
          pagesEdited: stats.pagesEdited,
          pagesCreated: stats.pagesCreated,
          lastEditAt: stats.lastEditAt,
        };
      })
      .filter((person) => person.isAssignedStaff || person.edits > 0)
      .sort((left, right) =>
        right.edits - left.edits ||
        (ROLE_ORDER.get(left.role) ?? 99) - (ROLE_ORDER.get(right.role) ?? 99) ||
        left.displayName.localeCompare(right.displayName) ||
        left.email.localeCompare(right.email)
      );

    return json({
      ok: true,
      range: { start: range.start, end: range.end },
      scope,
      defaultScope,
      rules: {
        assignedStaffRoles: ["owner", "admin", "wiki_editor"],
        includeZeroEditAssignedStaff: true,
        excludeZeroEditUnassignedUsers: true,
      },
      totals: {
        edits: contributors.reduce((sum, person) => sum + person.edits, 0),
        pagesCreated: contributors.reduce((sum, person) => sum + person.pagesCreated, 0),
        editorsWithEdits: contributors.filter((person) => person.edits > 0).length,
        listedContributors: contributors.length,
      },
      contributors,
      topPages: topPagesResult.rows.map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        isDeleted: page.is_deleted === true,
        edits: Number(page.edits) || 0,
      })),
    });
  } catch (error) {
    console.error("wiki-analytics failed", error);
    return json({ error: "The wiki analytics report could not be generated." }, 500);
  } finally {
    client.release();
  }
}
