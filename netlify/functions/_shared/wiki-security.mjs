import { createHmac, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

export const DEFAULT_OWNER_ACCOUNTS = new Set([
  "jb141598@gmail.com",
  "jb14296@bullischarterschool.com",
]);
export const STAFF_ROLES = new Set(["owner", "admin", "wiki_editor"]);
export const ASSIGNABLE_ROLES = new Set(["admin", "wiki_editor"]);

const DEFAULT_GOOGLE_CLIENT_ID =
  "609911855152-3q1n4oiiaaokhq0lrr0blf1bdif6ev6q.apps.googleusercontent.com";
const ROLE_ORDER = new Map([
  ["owner", 0],
  ["admin", 1],
  ["wiki_editor", 2],
]);
const googleClient = new OAuth2Client();
const WIKI_SESSION_ISSUER = "carbon-frontier-wiki";
const WIKI_SESSION_LIFETIME_SECONDS = 60 * 60 * 12;

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJwtPayloadUnsafe(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
}

function getWikiAuthSecret() {
  return String(getEnvironmentValue("WIKI_AUTH_SECRET") || "").trim();
}

function signWikiSessionParts(headerPart, payloadPart, secret) {
  return createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64url");
}

export function createWikiSessionToken(account, lifetimeSeconds = WIKI_SESSION_LIFETIME_SECONDS) {
  const secret = getWikiAuthSecret();
  if (secret.length < 32) {
    throw new Error("WIKI_AUTH_SECRET must be configured with at least 32 characters.");
  }

  const email = normalizeEmail(account?.email);
  if (!isValidEmail(email)) {
    throw new Error("A valid email is required to create a wiki session.");
  }

  const now = Math.floor(Date.now() / 1000);
  const headerPart = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payloadPart = base64UrlJson({
    iss: WIKI_SESSION_ISSUER,
    sub: email,
    email,
    email_verified: true,
    auth_method: "password",
    iat: now,
    exp: now + Math.max(300, Number(lifetimeSeconds) || WIKI_SESSION_LIFETIME_SECONDS),
  });
  const signature = signWikiSessionParts(headerPart, payloadPart, secret);
  return `${headerPart}.${payloadPart}.${signature}`;
}

export function verifyWikiSessionToken(token) {
  const secret = getWikiAuthSecret();
  if (secret.length < 32) return null;

  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, suppliedSignature] = parts;
  const payload = decodeJwtPayloadUnsafe(token);
  if (!payload || payload.iss !== WIKI_SESSION_ISSUER || payload.auth_method !== "password") {
    return null;
  }

  const expectedSignature = signWikiSessionParts(headerPart, payloadPart, secret);
  const left = Buffer.from(suppliedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  const now = Math.floor(Date.now() / 1000);
  const email = normalizeEmail(payload.email || payload.sub);
  if (!isValidEmail(email) || payload.email_verified !== true) return null;
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) return null;
  if (Number(payload.iat || 0) > now + 60) return null;

  return {
    email,
    name: "",
    picture: "",
    authMethod: "password",
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return (
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

export function getEnvironmentValue(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || "";
}

export function getConfiguredOwnerAccounts() {
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

export async function verifyGoogleRequest(request, { optional = false } = {}) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!idToken) {
    return optional
      ? { ok: true, account: null }
      : { ok: false, status: 401, message: "Sign in with a verified email first." };
  }

  const unverifiedPayload = decodeJwtPayloadUnsafe(idToken);
  if (unverifiedPayload?.iss === WIKI_SESSION_ISSUER) {
    const account = verifyWikiSessionToken(idToken);
    return account
      ? { ok: true, account }
      : { ok: false, status: 401, message: "Your sign-in expired. Sign in again and retry." };
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
        authMethod: "google",
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

export function verifyMutationOrigin(request) {
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

function sortMembers(members) {
  return [...members].sort((left, right) => {
    const roleDifference =
      (ROLE_ORDER.get(left.role) ?? 99) - (ROLE_ORDER.get(right.role) ?? 99);
    return roleDifference || left.email.localeCompare(right.email);
  });
}

function normalizeSettings(row) {
  const visibility = row?.visibility === "public" ? "public" : "private";
  const requestedEditingMode = row?.editing_mode === "open" ? "open" : "restricted";
  return {
    visibility,
    editingMode: visibility === "private" ? "restricted" : requestedEditingMode,
    reviewMode: row?.review_mode === "approval" ? "approval" : "immediate",
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: normalizeEmail(row?.updated_by_email) || null,
  };
}

function normalizeMembers(rows) {
  const membersByEmail = new Map();
  for (const row of rows || []) {
    const email = normalizeEmail(row?.email);
    const role = String(row?.role || "").trim().toLowerCase();
    if (!isValidEmail(email) || !STAFF_ROLES.has(role)) {
      continue;
    }
    membersByEmail.set(email, {
      email,
      role,
      assignedAt: row?.assigned_at ? new Date(row.assigned_at).toISOString() : null,
      assignedBy: normalizeEmail(row?.assigned_by_email) || "system",
    });
  }

  const now = new Date().toISOString();
  getConfiguredOwnerAccounts().forEach((email) => {
    const existing = membersByEmail.get(email);
    membersByEmail.set(email, {
      email,
      role: "owner",
      assignedAt: existing?.assignedAt || now,
      assignedBy: existing?.assignedBy || "system",
    });
  });
  return sortMembers(membersByEmail.values());
}

export async function ensureConfiguredOwners(client) {
  for (const email of getConfiguredOwnerAccounts()) {
    await client.query(
      `INSERT INTO wiki_members (email, role, assigned_by_email)
       VALUES ($1, 'owner', 'system')
       ON CONFLICT (email) DO UPDATE SET role = 'owner'`,
      [email]
    );
  }
}

export async function loadAccessState(client, { includeAudit = false } = {}) {
  const [settingsResult, membersResult] = await Promise.all([
    client.query(
      `SELECT visibility, editing_mode, review_mode, updated_at, updated_by_email
       FROM wiki_settings
       WHERE id = 1`
    ),
    client.query(
      `SELECT email, role, assigned_at, assigned_by_email
       FROM wiki_members`
    ),
  ]);

  const state = {
    ...normalizeSettings(settingsResult.rows[0]),
    members: normalizeMembers(membersResult.rows),
    auditLog: [],
  };

  if (includeAudit) {
    const auditResult = await client.query(
      `SELECT id, action, actor_email, target_email, details_json, created_at
       FROM wiki_audit_log
       ORDER BY created_at DESC
       LIMIT 50`
    );
    state.auditLog = auditResult.rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor: normalizeEmail(row.actor_email),
      targetEmail: normalizeEmail(row.target_email) || null,
      at: new Date(row.created_at).toISOString(),
      ...(row.details_json && typeof row.details_json === "object" ? row.details_json : {}),
    }));
  }

  return state;
}

export function findRole(state, email) {
  const normalizedEmail = normalizeEmail(email);
  return state.members.find((member) => member.email === normalizedEmail)?.role || null;
}

export function createViewer(state, account) {
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
    canModerate: isOwner || isAdmin,
  };
}

export function createAccessPayload(state, account, { includeManagementData = false } = {}) {
  const viewer = createViewer(state, account);
  const payload = {
    ok: true,
    settings: {
      visibility: state.visibility,
      editingMode: state.editingMode,
      reviewMode: state.reviewMode,
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

  if (includeManagementData && viewer.canManageEditors) {
    payload.members = state.members;
    payload.auditLog = state.auditLog;
  }
  return payload;
}

export function canActorManageTarget(actorRole, targetRole) {
  if (actorRole === "owner") {
    return targetRole === "admin" || targetRole === "wiki_editor" || !targetRole;
  }
  if (actorRole === "admin") {
    return targetRole === "wiki_editor" || !targetRole;
  }
  return false;
}

export async function insertAuditEntry(client, entry) {
  await client.query(
    `INSERT INTO wiki_audit_log (
       id, action, actor_email, target_email, page_id, details_json
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      crypto.randomUUID(),
      entry.action,
      normalizeEmail(entry.actorEmail),
      normalizeEmail(entry.targetEmail) || null,
      entry.pageId || null,
      JSON.stringify(entry.details || {}),
    ]
  );
}
