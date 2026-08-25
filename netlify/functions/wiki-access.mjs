import { getStore } from "@netlify/blobs";
import { OAuth2Client } from "google-auth-library";

const DEFAULT_OWNER_ACCOUNTS = new Set([
  "jb141598@gmail.com",
  "jb14296@gmail.com",
]);
const DEFAULT_GOOGLE_CLIENT_ID =
  "609911855152-3q1n4oiiaaokhq0lrr0blf1bdif6ev6q.apps.googleusercontent.com";
const WIKI_ACCESS_STORE_NAME = "carbon-frontier-wiki-access";
const WIKI_ACCESS_STORE_KEY = "shared-state";
const STAFF_ROLES = new Set(["owner", "admin", "wiki_editor"]);
const ASSIGNABLE_ROLES = new Set(["admin", "wiki_editor"]);
const ROLE_ORDER = new Map([
  ["owner", 0],
  ["admin", 1],
  ["wiki_editor", 2],
]);
const MAX_AUDIT_ENTRIES = 200;

const googleClient = new OAuth2Client();

export const config = {
  path: "/api/wiki-access",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return (
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function getEnvironmentValue(name) {
  return (
    globalThis.Netlify?.env?.get(name) ||
    process.env[name] ||
    ""
  );
}

function getConfiguredOwnerAccounts() {
  const owners = new Set(DEFAULT_OWNER_ACCOUNTS);
  String(getEnvironmentValue("WIKI_OWNER_EMAILS"))
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(isValidEmail)
    .forEach((email) => owners.add(email));
  return owners;
}

function getGoogleAudience() {
  return getEnvironmentValue("GOOGLE_CLIENT_ID") || DEFAULT_GOOGLE_CLIENT_ID;
}

function normalizeMember(member) {
  const email = normalizeEmail(member?.email);
  const role = String(member?.role || "").trim().toLowerCase();
  if (!isValidEmail(email) || !ASSIGNABLE_ROLES.has(role)) {
    return null;
  }

  return {
    email,
    role,
    assignedAt: String(member?.assignedAt || "").trim() || null,
    assignedBy: normalizeEmail(member?.assignedBy) || null,
  };
}

function normalizeAuditEntry(entry) {
  const action = String(entry?.action || "").trim();
  const at = String(entry?.at || "").trim();
  const actor = normalizeEmail(entry?.actor);
  if (!action || !at || !actor) {
    return null;
  }

  return {
    id: String(entry?.id || "").trim() || crypto.randomUUID(),
    action,
    at,
    actor,
    targetEmail: normalizeEmail(entry?.targetEmail) || null,
    previousRole: String(entry?.previousRole || "").trim() || null,
    nextRole: String(entry?.nextRole || "").trim() || null,
    visibility: ["public", "private"].includes(entry?.visibility)
      ? entry.visibility
      : null,
    editingMode: ["open", "restricted"].includes(entry?.editingMode)
      ? entry.editingMode
      : null,
  };
}

function sortMembers(members) {
  return [...members].sort((left, right) => {
    const roleDifference =
      (ROLE_ORDER.get(left.role) ?? 99) - (ROLE_ORDER.get(right.role) ?? 99);
    return roleDifference || left.email.localeCompare(right.email);
  });
}

function normalizeState(storedState) {
  const configuredOwners = getConfiguredOwnerAccounts();
  const now = new Date().toISOString();
  const membersByEmail = new Map();

  if (Array.isArray(storedState?.members)) {
    storedState.members.map(normalizeMember).filter(Boolean).forEach((member) => {
      membersByEmail.set(member.email, member);
    });
  }

  configuredOwners.forEach((email) => {
    const existing = membersByEmail.get(email);
    membersByEmail.set(email, {
      email,
      role: "owner",
      assignedAt: existing?.assignedAt || now,
      assignedBy: existing?.assignedBy || "system",
    });
  });

  const visibility = storedState?.visibility === "public" ? "public" : "private";
  const requestedEditingMode =
    storedState?.editingMode === "open" ? "open" : "restricted";
  const editingMode = visibility === "private" ? "restricted" : requestedEditingMode;
  const auditLog = Array.isArray(storedState?.auditLog)
    ? storedState.auditLog
        .map(normalizeAuditEntry)
        .filter(Boolean)
        .slice(-MAX_AUDIT_ENTRIES)
    : [];

  return {
    schemaVersion: 1,
    visibility,
    editingMode,
    members: sortMembers(membersByEmail.values()),
    auditLog,
    updatedAt: String(storedState?.updatedAt || "").trim() || null,
    updatedBy: normalizeEmail(storedState?.updatedBy) || null,
  };
}

async function loadState(store) {
  const storedState = await store.get(WIKI_ACCESS_STORE_KEY, { type: "json" });
  return {
    exists: storedState !== null,
    state: normalizeState(storedState),
  };
}

function addAuditEntry(state, entry) {
  state.auditLog = [
    ...state.auditLog,
    {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      ...entry,
    },
  ].slice(-MAX_AUDIT_ENTRIES);
}

async function saveState(store, state, actor) {
  state.members = sortMembers(state.members);
  state.updatedAt = new Date().toISOString();
  state.updatedBy = actor;
  await store.setJSON(WIKI_ACCESS_STORE_KEY, state);
}

function findRole(state, email) {
  if (!email) {
    return null;
  }
  return state.members.find((member) => member.email === email)?.role || null;
}

function createViewer(state, account) {
  const email = normalizeEmail(account?.email);
  const role = findRole(state, email);
  const authenticated = Boolean(email);
  const isAssignedStaff = STAFF_ROLES.has(role);
  const isOwner = role === "owner";
  const isAdmin = role === "admin";

  return {
    authenticated,
    email: authenticated ? email : null,
    name: authenticated ? String(account?.name || "").trim() || null : null,
    picture: authenticated ? String(account?.picture || "").trim() || null : null,
    role,
    isAssignedStaff,
    canView: state.visibility === "public" || isAssignedStaff,
    canEdit:
      isAssignedStaff ||
      (authenticated && state.visibility === "public" && state.editingMode === "open"),
    canManageAdmins: isOwner,
    canManageEditors: isOwner || isAdmin,
    canManageSettings: isOwner || isAdmin,
  };
}

function createAccessPayload(state, account, options = {}) {
  const viewer = createViewer(state, account);
  const payload = {
    ok: true,
    settings: {
      visibility: state.visibility,
      editingMode: state.editingMode,
    },
    viewer,
    analytics: {
      defaultScope:
        state.visibility === "public" && state.editingMode === "open"
          ? "all_editors"
          : "assigned_staff",
      assignedStaffRoles: ["owner", "admin", "wiki_editor"],
      includeZeroEditAssignedStaff: true,
      excludeZeroEditUnassignedUsers: true,
    },
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
  };

  if (options.includeManagementData && viewer.canManageEditors) {
    payload.members = state.members;
    payload.auditLog = [...state.auditLog].reverse().slice(0, 50);
  }

  return payload;
}

async function verifyGoogleRequest(request, { optional = false } = {}) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!idToken) {
    return optional
      ? { ok: true, account: null }
      : { ok: false, status: 401, message: "Sign in before changing wiki access." };
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: getGoogleAudience(),
    });
    const payload = ticket.getPayload();
    const email = normalizeEmail(payload?.email);

    if (!email || payload?.email_verified === false) {
      return {
        ok: false,
        status: 401,
        message: "The signed-in email could not be verified.",
      };
    }

    return {
      ok: true,
      account: {
        email,
        name: String(payload?.name || "").trim(),
        picture: String(payload?.picture || "").trim(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      message: "Your sign-in expired. Sign in again and retry.",
    };
  }
}

function verifyMutationOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch (error) {
    return false;
  }
}

function canActorManageTarget(actorRole, targetRole) {
  if (actorRole === "owner") {
    return targetRole === "admin" || targetRole === "wiki_editor" || !targetRole;
  }
  if (actorRole === "admin") {
    return targetRole === "wiki_editor" || !targetRole;
  }
  return false;
}

async function handleUpsertMember(store, state, account, body) {
  const actorRole = findRole(state, account.email);
  const targetEmail = normalizeEmail(body?.email);
  const nextRole = String(body?.role || "").trim().toLowerCase();

  if (!isValidEmail(targetEmail)) {
    return json({ error: "Enter a valid email address." }, 400);
  }
  if (!ASSIGNABLE_ROLES.has(nextRole)) {
    return json({ error: "Choose Admin or Wiki Editor." }, 400);
  }

  const existingMember = state.members.find((member) => member.email === targetEmail);
  const previousRole = existingMember?.role || null;

  if (previousRole === "owner" || getConfiguredOwnerAccounts().has(targetEmail)) {
    return json({ error: "Owner access is controlled by the protected owner configuration." }, 403);
  }
  if (nextRole === "admin" && actorRole !== "owner") {
    return json({ error: "Only an owner can add or change an admin." }, 403);
  }
  if (!canActorManageTarget(actorRole, previousRole)) {
    return json({ error: "You do not have permission to change this member." }, 403);
  }

  const nextMember = {
    email: targetEmail,
    role: nextRole,
    assignedAt:
      previousRole === nextRole && existingMember?.assignedAt
        ? existingMember.assignedAt
        : new Date().toISOString(),
    assignedBy: account.email,
  };

  state.members = state.members.filter((member) => member.email !== targetEmail);
  state.members.push(nextMember);
  addAuditEntry(state, {
    action: previousRole ? "member_role_changed" : "member_added",
    actor: account.email,
    targetEmail,
    previousRole,
    nextRole,
  });
  await saveState(store, state, account.email);

  return json(createAccessPayload(state, account, { includeManagementData: true }));
}

async function handleRemoveMember(store, state, account, body) {
  const actorRole = findRole(state, account.email);
  const targetEmail = normalizeEmail(body?.email);
  const existingMember = state.members.find((member) => member.email === targetEmail);
  const previousRole = existingMember?.role || null;

  if (!isValidEmail(targetEmail) || !existingMember) {
    return json({ error: "That assigned wiki member was not found." }, 404);
  }
  if (previousRole === "owner" || getConfiguredOwnerAccounts().has(targetEmail)) {
    return json({ error: "Owners cannot be removed from the wiki access panel." }, 403);
  }
  if (!canActorManageTarget(actorRole, previousRole)) {
    return json({ error: "You do not have permission to remove this member." }, 403);
  }

  state.members = state.members.filter((member) => member.email !== targetEmail);
  addAuditEntry(state, {
    action: "member_removed",
    actor: account.email,
    targetEmail,
    previousRole,
    nextRole: null,
  });
  await saveState(store, state, account.email);

  return json(createAccessPayload(state, account, { includeManagementData: true }));
}

async function handleUpdateSettings(store, state, account, body) {
  const actorRole = findRole(state, account.email);
  if (actorRole !== "owner" && actorRole !== "admin") {
    return json({ error: "Only wiki owners and admins can change wiki settings." }, 403);
  }

  const visibility = body?.visibility === "public" ? "public" : "private";
  const requestedEditingMode = body?.editingMode === "open" ? "open" : "restricted";
  const editingMode = visibility === "private" ? "restricted" : requestedEditingMode;

  state.visibility = visibility;
  state.editingMode = editingMode;
  addAuditEntry(state, {
    action: "settings_updated",
    actor: account.email,
    visibility,
    editingMode,
  });
  await saveState(store, state, account.email);

  return json(createAccessPayload(state, account, { includeManagementData: true }));
}

export default async function handler(request) {
  const store = getStore({
    name: WIKI_ACCESS_STORE_NAME,
    consistency: "strong",
  });

  if (request.method === "GET") {
    const auth = await verifyGoogleRequest(request, { optional: true });
    if (!auth.ok) {
      return json({ error: auth.message }, auth.status);
    }

    const { state } = await loadState(store);
    const viewer = createViewer(state, auth.account);
    const includeManagementData =
      new URL(request.url).searchParams.get("includeMembers") === "1" &&
      viewer.canManageEditors;

    return json(createAccessPayload(state, auth.account, { includeManagementData }));
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

  const { state } = await loadState(store);
  const actorRole = findRole(state, auth.account.email);
  if (actorRole !== "owner" && actorRole !== "admin") {
    return json({ error: "This account cannot manage wiki access." }, 403);
  }

  if (body?.action === "upsert_member") {
    return handleUpsertMember(store, state, auth.account, body);
  }
  if (body?.action === "remove_member") {
    return handleRemoveMember(store, state, auth.account, body);
  }
  if (body?.action === "update_settings") {
    return handleUpdateSettings(store, state, auth.account, body);
  }

  return json({ error: "Unknown wiki access action." }, 400);
}
