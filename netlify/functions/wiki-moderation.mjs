import { getDatabase } from "@netlify/database";
import {
  createViewer,
  findRole,
  insertAuditEntry,
  isValidEmail,
  json,
  loadAccessState,
  normalizeEmail,
  verifyGoogleRequest,
  verifyMutationOrigin,
} from "./_shared/wiki-security.mjs";

const db = getDatabase();

export const config = {
  path: "/api/wiki/moderation",
};

function submissionFromRow(row) {
  return {
    id: row.id,
    type: row.submission_type,
    pageId: row.page_id || null,
    slug: row.requested_slug,
    title: row.page_title,
    baseRevisionId: row.base_revision_id || null,
    baseRevisionNumber: row.base_revision_number
      ? Number(row.base_revision_number)
      : null,
    content: row.content_json,
    editSummary: row.edit_summary || "",
    authorEmail: normalizeEmail(row.author_email),
    authorName: row.author_name || null,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function blockFromRow(row) {
  return {
    email: normalizeEmail(row.email),
    reason: row.reason || "",
    blockedBy: normalizeEmail(row.blocked_by_email),
    blockedAt: new Date(row.blocked_at).toISOString(),
  };
}

function auditFromRow(row) {
  return {
    id: row.id,
    action: row.action,
    actorEmail: normalizeEmail(row.actor_email),
    targetEmail: normalizeEmail(row.target_email) || null,
    pageId: row.page_id || null,
    pageTitle: row.page_title || null,
    pageSlug: row.page_slug || null,
    details: row.details_json && typeof row.details_json === "object"
      ? row.details_json
      : {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function loadModerationPayload(client, state, viewer) {
  const [pendingResult, blocksResult, auditResult] = await Promise.all([
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
  ]);

  return {
    ok: true,
    settings: { reviewMode: state.reviewMode },
    viewer,
    totals: {
      pending: pendingResult.rowCount,
      blocked: blocksResult.rowCount,
      activityEntries: auditResult.rowCount,
    },
    pendingEdits: pendingResult.rows.map(submissionFromRow),
    blockedUsers: blocksResult.rows.map(blockFromRow),
    activity: auditResult.rows.map(auditFromRow),
  };
}

async function loadAuthorized(client, account) {
  const state = await loadAccessState(client);
  const viewer = createViewer(state, account);
  if (!viewer.canModerate) {
    return { ok: false, response: json({ error: "Only wiki owners and admins can moderate contributions." }, 403) };
  }
  return { ok: true, state, viewer };
}

async function markSuperseded(client, submission, account, message) {
  await client.query(
    `UPDATE wiki_pending_edits
     SET status = 'superseded', reviewed_by_email = $1, reviewed_at = NOW(), review_note = $2
     WHERE id = $3`,
    [account.email, message.slice(0, 500), submission.id]
  );
  await insertAuditEntry(client, {
    action: "page_edit_superseded",
    actorEmail: account.email,
    targetEmail: submission.author_email,
    pageId: submission.page_id,
    details: {
      submissionId: submission.id,
      submissionType: submission.submission_type,
      slug: submission.requested_slug,
      reason: message,
    },
  });
}

async function approveSubmission(client, account, state, body) {
  const submissionId = String(body?.submissionId || "").trim();
  const reviewNote = String(body?.reviewNote || "").trim().slice(0, 500);
  if (!submissionId) {
    return { status: 400, error: "Choose a pending edit to approve." };
  }
  const submissionResult = await client.query(
    `SELECT * FROM wiki_pending_edits WHERE id = $1 FOR UPDATE`,
    [submissionId]
  );
  const submission = submissionResult.rows[0];
  if (!submission || submission.status !== "pending") {
    return { status: 404, error: "That pending edit is no longer available." };
  }

  let pageId = submission.page_id;
  let revisionId = crypto.randomUUID();
  let revisionNumber = 1;
  if (submission.submission_type === "create") {
    const conflict = await client.query(
      `SELECT 1 FROM wiki_pages WHERE slug = $1
       UNION ALL
       SELECT 1 FROM wiki_redirects WHERE source_slug = $1
       LIMIT 1`,
      [submission.requested_slug]
    );
    if (conflict.rowCount) {
      const message = "This page address was taken after the contribution was submitted.";
      await markSuperseded(client, submission, account, message);
      return { status: 409, error: message, committedError: true };
    }
    pageId = crypto.randomUUID();
    await client.query(
      `INSERT INTO wiki_pages (
         id, slug, title, allow_normal_edits, created_by_email, updated_by_email
       ) VALUES ($1, $2, $3, TRUE, $4, $4)`,
      [pageId, submission.requested_slug, submission.page_title, submission.author_email]
    );
  } else {
    const pageResult = await client.query(
      `SELECT id, slug, current_revision_id,
              COALESCE((
                SELECT revision_number FROM wiki_revisions WHERE id = current_revision_id
              ), 0) AS revision_number
       FROM wiki_pages
       WHERE id = $1 AND is_deleted = FALSE
       FOR UPDATE`,
      [submission.page_id]
    );
    const page = pageResult.rows[0];
    if (!page) {
      const message = "The page was removed after this contribution was submitted.";
      await markSuperseded(client, submission, account, message);
      return { status: 409, error: message, committedError: true };
    }
    if (page.current_revision_id !== submission.base_revision_id) {
      const message = "The page changed after this contribution was submitted. Review the newer page before resubmitting the change.";
      await markSuperseded(client, submission, account, message);
      return { status: 409, error: message, committedError: true };
    }
    revisionNumber = Number(page.revision_number) + 1;
  }

  const authorRole = findRole(state, submission.author_email) || "contributor";
  await client.query(
    `INSERT INTO wiki_revisions (
       id, page_id, revision_number, page_title, content_json, edit_summary,
       author_email, author_name, author_role
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
    [
      revisionId,
      pageId,
      revisionNumber,
      submission.page_title,
      JSON.stringify(submission.content_json),
      submission.edit_summary,
      submission.author_email,
      submission.author_name || null,
      authorRole,
    ]
  );
  await client.query(
    `UPDATE wiki_pages
     SET title = $1, current_revision_id = $2, updated_at = NOW(), updated_by_email = $3
     WHERE id = $4`,
    [submission.page_title, revisionId, submission.author_email, pageId]
  );
  await client.query(
    `UPDATE wiki_pending_edits
     SET status = 'approved', reviewed_by_email = $1, reviewed_at = NOW(), review_note = $2
     WHERE id = $3`,
    [account.email, reviewNote, submission.id]
  );
  await insertAuditEntry(client, {
    action: "page_edit_approved",
    actorEmail: account.email,
    targetEmail: submission.author_email,
    pageId,
    details: {
      submissionId: submission.id,
      submissionType: submission.submission_type,
      slug: submission.requested_slug,
      revisionId,
      revisionNumber,
      reviewNote,
    },
  });
  return {
    status: 200,
    result: {
      submissionId: submission.id,
      slug: submission.requested_slug,
      revisionNumber,
    },
  };
}

async function mutateModeration(client, account, state, body) {
  const action = String(body?.action || "").trim();
  if (action === "approve_submission") {
    return approveSubmission(client, account, state, body);
  }

  if (action === "reject_submission") {
    const submissionId = String(body?.submissionId || "").trim();
    const reviewNote = String(body?.reviewNote || "").trim().slice(0, 500);
    if (!submissionId) {
      return { status: 400, error: "Choose a pending edit to reject." };
    }
    const result = await client.query(
      `UPDATE wiki_pending_edits
       SET status = 'rejected', reviewed_by_email = $1, reviewed_at = NOW(), review_note = $2
       WHERE id = $3 AND status = 'pending'
       RETURNING id, author_email, page_id, submission_type, requested_slug`,
      [account.email, reviewNote, submissionId]
    );
    const submission = result.rows[0];
    if (!submission) {
      return { status: 404, error: "That pending edit is no longer available." };
    }
    await insertAuditEntry(client, {
      action: "page_edit_rejected",
      actorEmail: account.email,
      targetEmail: submission.author_email,
      pageId: submission.page_id,
      details: {
        submissionId,
        submissionType: submission.submission_type,
        slug: submission.requested_slug,
        reviewNote,
      },
    });
    return { status: 200, result: { submissionId } };
  }

  if (action === "block_user") {
    const email = normalizeEmail(body?.email);
    const reason = String(body?.reason || "").trim().slice(0, 300);
    if (!isValidEmail(email)) {
      return { status: 400, error: "Enter a valid contributor email address." };
    }
    if (findRole(state, email)) {
      return { status: 403, error: "Assigned Owners, Admins, and Wiki Editors cannot be blocked." };
    }
    await client.query(
      `INSERT INTO wiki_blocked_users (email, reason, blocked_by_email, blocked_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (email) DO UPDATE
       SET reason = EXCLUDED.reason,
           blocked_by_email = EXCLUDED.blocked_by_email,
           blocked_at = NOW()`,
      [email, reason, account.email]
    );
    await client.query(
      `UPDATE wiki_pending_edits
       SET status = 'rejected', reviewed_by_email = $1, reviewed_at = NOW(),
           review_note = CASE WHEN review_note = '' THEN 'Contributor blocked.' ELSE review_note END
       WHERE author_email = $2 AND status = 'pending'`,
      [account.email, email]
    );
    await insertAuditEntry(client, {
      action: "contributor_blocked",
      actorEmail: account.email,
      targetEmail: email,
      details: { reason },
    });
    return { status: 200, result: { email } };
  }

  if (action === "unblock_user") {
    const email = normalizeEmail(body?.email);
    if (!isValidEmail(email)) {
      return { status: 400, error: "Choose a blocked contributor." };
    }
    const result = await client.query(
      `DELETE FROM wiki_blocked_users WHERE email = $1 RETURNING email`,
      [email]
    );
    if (!result.rowCount) {
      return { status: 404, error: "That contributor is not blocked." };
    }
    await insertAuditEntry(client, {
      action: "contributor_unblocked",
      actorEmail: account.email,
      targetEmail: email,
    });
    return { status: 200, result: { email } };
  }

  return { status: 400, error: "Unknown moderation action." };
}

export default async function handler(request) {
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: "Method not allowed." }, 405);
  }
  if (request.method === "POST" && !verifyMutationOrigin(request)) {
    return json({ error: "Cross-site moderation request blocked." }, 403);
  }
  const auth = await verifyGoogleRequest(request);
  if (!auth.ok) {
    return json({ error: auth.message }, auth.status);
  }

  const client = await db.pool.connect();
  let committed = false;
  try {
    if (request.method === "GET") {
      const authorization = await loadAuthorized(client, auth.account);
      if (!authorization.ok) return authorization.response;
      return json(await loadModerationPayload(client, authorization.state, authorization.viewer));
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    await client.query("BEGIN");
    const authorization = await loadAuthorized(client, auth.account);
    if (!authorization.ok) return authorization.response;
    const mutation = await mutateModeration(client, auth.account, authorization.state, body);
    if (mutation.error && !mutation.committedError) {
      return json({ error: mutation.error }, mutation.status);
    }
    await client.query("COMMIT");
    committed = true;
    if (mutation.error) {
      return json({ error: mutation.error }, mutation.status);
    }
    const freshState = await loadAccessState(client);
    const viewer = createViewer(freshState, auth.account);
    return json({
      ...(await loadModerationPayload(client, freshState, viewer)),
      mutation: mutation.result,
    });
  } catch (error) {
    console.error("wiki-moderation failed", error);
    return json({ error: "The moderation request could not be completed." }, 500);
  } finally {
    if (request.method === "POST" && !committed) {
      await client.query("ROLLBACK").catch(() => {});
    }
    client.release();
  }
}
