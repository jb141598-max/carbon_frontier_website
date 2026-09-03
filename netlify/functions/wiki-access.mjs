import { getDatabase } from "@netlify/database";
import {
  ASSIGNABLE_ROLES,
  canActorManageTarget,
  createAccessPayload,
  ensureConfiguredOwners,
  findRole,
  getConfiguredOwnerAccounts,
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
  path: "/api/wiki-access",
};

async function loadPayload(account, includeManagementData = false) {
  const client = await db.pool.connect();
  try {
    const state = await loadAccessState(client, {
      includeAudit: includeManagementData,
    });
    return createAccessPayload(state, account, { includeManagementData });
  } finally {
    client.release();
  }
}

async function mutateAccess(account, body) {
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await ensureConfiguredOwners(client);
    await client.query("SELECT id FROM wiki_settings WHERE id = 1 FOR UPDATE");
    const state = await loadAccessState(client);
    const actorRole = findRole(state, account.email);

    if (actorRole !== "owner" && actorRole !== "admin") {
      return { status: 403, error: "This account cannot manage wiki access." };
    }

    if (body?.action === "update_settings") {
      const visibility = body?.visibility === "public" ? "public" : "private";
      const requestedEditingMode = body?.editingMode === "open" ? "open" : "restricted";
      const editingMode = visibility === "private" ? "restricted" : requestedEditingMode;
      const reviewMode = body?.reviewMode === undefined
        ? state.reviewMode
        : body.reviewMode === "approval"
          ? "approval"
          : "immediate";

      await client.query(
        `UPDATE wiki_settings
         SET visibility = $1,
             editing_mode = $2,
             review_mode = $3,
             updated_at = NOW(),
             updated_by_email = $4
         WHERE id = 1`,
        [visibility, editingMode, reviewMode, account.email]
      );
      await insertAuditEntry(client, {
        action: "settings_updated",
        actorEmail: account.email,
        details: { visibility, editingMode, reviewMode },
      });
      await client.query("COMMIT");
      committed = true;
      return { status: 200 };
    }

    if (body?.action === "upsert_member") {
      const targetEmail = normalizeEmail(body?.email);
      const nextRole = String(body?.role || "").trim().toLowerCase();
      const previousRole = findRole(state, targetEmail);

      if (!isValidEmail(targetEmail)) {
        return { status: 400, error: "Enter a valid email address." };
      }
      if (!ASSIGNABLE_ROLES.has(nextRole)) {
        return { status: 400, error: "Choose Admin or Wiki Editor." };
      }
      if (previousRole === "owner" || getConfiguredOwnerAccounts().has(targetEmail)) {
        return {
          status: 403,
          error: "Owner access is controlled by the protected owner configuration.",
        };
      }
      if (nextRole === "admin" && actorRole !== "owner") {
        return { status: 403, error: "Only an owner can add or change an admin." };
      }
      if (!canActorManageTarget(actorRole, previousRole)) {
        return { status: 403, error: "You do not have permission to change this member." };
      }

      await client.query(
        `INSERT INTO wiki_members (email, role, assigned_at, assigned_by_email)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (email) DO UPDATE
         SET role = EXCLUDED.role,
             assigned_at = CASE
               WHEN wiki_members.role = EXCLUDED.role THEN wiki_members.assigned_at
               ELSE NOW()
             END,
             assigned_by_email = EXCLUDED.assigned_by_email`,
        [targetEmail, nextRole, account.email]
      );
      await insertAuditEntry(client, {
        action: previousRole ? "member_role_changed" : "member_added",
        actorEmail: account.email,
        targetEmail,
        details: { previousRole, nextRole },
      });
      await client.query("COMMIT");
      committed = true;
      return { status: 200 };
    }

    if (body?.action === "remove_member") {
      const targetEmail = normalizeEmail(body?.email);
      const previousRole = findRole(state, targetEmail);

      if (!isValidEmail(targetEmail) || !previousRole) {
        return { status: 404, error: "That assigned wiki member was not found." };
      }
      if (previousRole === "owner" || getConfiguredOwnerAccounts().has(targetEmail)) {
        return { status: 403, error: "Owners cannot be removed from the wiki access panel." };
      }
      if (!canActorManageTarget(actorRole, previousRole)) {
        return { status: 403, error: "You do not have permission to remove this member." };
      }

      await client.query("DELETE FROM wiki_members WHERE email = $1", [targetEmail]);
      await insertAuditEntry(client, {
        action: "member_removed",
        actorEmail: account.email,
        targetEmail,
        details: { previousRole, nextRole: null },
      });
      await client.query("COMMIT");
      committed = true;
      return { status: 200 };
    }

    return { status: 400, error: "Unknown wiki access action." };
  } catch (error) {
    throw error;
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

      const wantsMembers = new URL(request.url).searchParams.get("includeMembers") === "1";
      const basePayload = await loadPayload(auth.account, false);
      const includeManagementData = wantsMembers && basePayload.viewer.canManageEditors;
      return json(
        includeManagementData
          ? await loadPayload(auth.account, true)
          : basePayload
      );
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }
    if (!verifyMutationOrigin(request)) {
      return json({ error: "Cross-site wiki access request blocked." }, 403);
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

    const result = await mutateAccess(auth.account, body);
    if (result.error) {
      return json({ error: result.error }, result.status);
    }
    return json(await loadPayload(auth.account, true));
  } catch (error) {
    console.error("wiki-access failed", error);
    return json({ error: "The wiki database could not complete this request." }, 500);
  }
}
