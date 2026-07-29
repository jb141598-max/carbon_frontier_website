import { getStore } from "@netlify/blobs";
import { OAuth2Client } from "google-auth-library";

const ADMIN_ACCOUNTS = new Set([
  "jb141598@gmail.com",
  "jb14296@gmail.com",
]);

const DEFAULT_GOOGLE_CLIENT_ID =
  "609911855152-3q1n4oiiaaokhq0lrr0blf1bdif6ev6q.apps.googleusercontent.com";

const UPDATES_STORE_NAME = "carbon-frontier-updates";
const UPDATES_STORE_KEY = "shared-state";

const googleClient = new OAuth2Client();

export const config = {
  path: "/api/updates",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUpdateRow(row) {
  const header = String(row?.header || "").trim();
  const description = String(row?.description || "").trim();
  const imagePath = String(row?.imagePath || "").trim();

  const hasHeader = row?.hasHeader === true && header.length > 0;
  const hasDescription =
    row?.hasDescription === true && description.length > 0;
  const hasImage = row?.hasImage !== false && imagePath.length > 0;
  const imageSide = row?.imageSide === "right" ? "right" : "left";

  return {
    id: String(row?.id || "").trim() || crypto.randomUUID(),
    hasHeader,
    header,
    hasDescription,
    description,
    hasImage,
    imagePath,
    imageSide,
  };
}

function rowHasContent(row) {
  return row.hasHeader || row.hasDescription || row.hasImage;
}

function getClampedHeaderImageHeight(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 320;
  }

  return Math.min(900, Math.max(120, Math.round(numericValue)));
}

function normalizeUpdate(update, index = 0) {
  const version = String(update?.version || "").trim();
  const date = String(update?.date || "").trim();

  const header = String(update?.header || "").trim();
  const hasHeader = update?.hasHeader === true && header.length > 0;

  const headerImagePath = String(update?.headerImagePath || "").trim();
  const hasHeaderImage =
    update?.hasHeaderImage === true && headerImagePath.length > 0;
  const headerImageHeight = getClampedHeaderImageHeight(
    update?.headerImageHeight
  );

  const isArchived = update?.isArchived === true;

  const rows = Array.isArray(update?.rows)
    ? update.rows.map(normalizeUpdateRow).filter(rowHasContent)
    : [];

  return {
    id: String(update?.id || "").trim() || crypto.randomUUID(),
    version: version || `Update ${index + 1}`,
    date,

    hasHeader,
    header,

    hasHeaderImage,
    headerImagePath,
    headerImageHeight,

    isArchived,
    rows,
  };
}

function normalizeState(payload) {
  if (Array.isArray(payload?.updates)) {
    return {
      updates: payload.updates
        .map(normalizeUpdate)
        .filter((update) => update.version || update.rows.length > 0),
    };
  }

  const legacyRows = Array.isArray(payload?.rows)
    ? payload.rows.map(normalizeUpdateRow).filter(rowHasContent)
    : [];

  return {
    updates: legacyRows.length
      ? [
          {
            id: crypto.randomUUID(),
            version: "Update 1",
            date: "",

            hasHeader: false,
            header: "",

            hasHeaderImage: false,
            headerImagePath: "",
            headerImageHeight: 320,

            isArchived: false,
            rows: legacyRows,
          },
        ]
      : [],
  };
}

async function verifyAdminRequest(request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!idToken) {
    return {
      ok: false,
      message: "Missing Google ID token.",
    };
  }

  const audience =
    globalThis.Netlify?.env?.get("GOOGLE_CLIENT_ID") ||
    process.env.GOOGLE_CLIENT_ID ||
    DEFAULT_GOOGLE_CLIENT_ID;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience,
    });

    const payload = ticket.getPayload();
    const email = normalizeEmail(payload?.email);

    if (!email || payload?.email_verified === false) {
      return {
        ok: false,
        message: "Google account could not be verified.",
      };
    }

    if (!ADMIN_ACCOUNTS.has(email)) {
      return {
        ok: false,
        message: "This email is not allowed to edit updates.",
      };
    }

    return {
      ok: true,
      email,
    };
  } catch (error) {
    return {
      ok: false,
      message: "Google sign-in token is invalid or expired.",
    };
  }
}

export default async function handler(request) {
  const store = getStore({
    name: UPDATES_STORE_NAME,
    consistency: "strong",
  });

  if (request.method === "GET") {
    const storedState = await store.get(UPDATES_STORE_KEY, {
      type: "json",
    });

    const normalizedState = normalizeState(storedState);

    return json({
      exists: storedState !== null,
      source: "netlify-blobs",
      ...normalizedState,
      updatedAt: storedState?.updatedAt || null,
      updatedBy: storedState?.updatedBy || null,
    });
  }

  if (request.method !== "POST") {
    return json(
      {
        error: "Method not allowed.",
      },
      405
    );
  }

  const auth = await verifyAdminRequest(request);

  if (!auth.ok) {
    return json(
      {
        error: auth.message,
      },
      401
    );
  }

  let body;

  try {
    body = await request.json();
  } catch (error) {
    return json(
      {
        error: "Request body must be valid JSON.",
      },
      400
    );
  }

  const nextState = {
    ...normalizeState(body),
    updatedAt: new Date().toISOString(),
    updatedBy: auth.email,
  };

  await store.setJSON(UPDATES_STORE_KEY, nextState);

  return json({
    ok: true,
    source: "netlify-blobs",
    ...nextState,
  });
}
