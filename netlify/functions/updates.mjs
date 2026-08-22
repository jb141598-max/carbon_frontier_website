import { getStore } from "@netlify/blobs";
import { OAuth2Client } from "google-auth-library";

const ADMIN_ACCOUNTS = new Set(["jb141598@gmail.com", "jb14296@gmail.com"]);
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

function normalizeImageWidth(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 100;
  }

  return Math.min(100, Math.max(10, Math.round(numericValue)));
}

function normalizeCaptionTextSize(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 18;
  }

  return Math.min(48, Math.max(12, Math.round(numericValue)));
}

function normalizeRowImage(image) {
  const imagePath = String(image?.imagePath || image?.path || "").trim();
  if (!imagePath) {
    return null;
  }

  const caption = String(image?.caption || "").trim();
  const hasCaption = image?.hasCaption === true && caption.length > 0;

  return {
    id: String(image?.id || "").trim() || crypto.randomUUID(),
    imagePath,
    widthPercent: normalizeImageWidth(image?.widthPercent),
    hasCaption,
    caption,
    captionTextSize: normalizeCaptionTextSize(image?.captionTextSize),
  };
}

function normalizeStandaloneCaption(caption) {
  const text = String(caption?.caption || caption?.text || "").trim();
  if (!text) {
    return null;
  }

  return {
    id: String(caption?.id || "").trim() || crypto.randomUUID(),
    caption: text,
    captionTextSize: normalizeCaptionTextSize(caption?.captionTextSize),
  };
}

function normalizeUpdateRow(row) {
  const header = String(row?.header || "").trim();
  const hasHeader = row?.hasHeader === true && header.length > 0;
  let images = Array.isArray(row?.images)
    ? row.images.map(normalizeRowImage).filter(Boolean)
    : [];
  const standaloneCaptions = Array.isArray(row?.standaloneCaptions)
    ? row.standaloneCaptions.map(normalizeStandaloneCaption).filter(Boolean)
    : Array.isArray(row?.captions)
      ? row.captions.map(normalizeStandaloneCaption).filter(Boolean)
      : [];

  // Migrate rows created before rows supported multiple pictures.
  if (images.length === 0) {
    const legacyImagePath = String(row?.imagePath || "").trim();
    if (legacyImagePath) {
      const legacyCaption = String(row?.description || "").trim();
      images = [
        {
          id: crypto.randomUUID(),
          imagePath: legacyImagePath,
          widthPercent: 100,
          hasCaption: row?.hasDescription === true && legacyCaption.length > 0,
          caption: legacyCaption,
          captionTextSize: 18,
        },
      ];
    }
  }

  return {
    id: String(row?.id || "").trim() || crypto.randomUUID(),
    hasHeader,
    header,
    images,
    standaloneCaptions,
  };
}

function rowHasContent(row) {
  return row.hasHeader || row.images.length > 0 || row.standaloneCaptions.length > 0;
}

function normalizeHeaderImageHeight(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 320;
  }

  return Math.min(900, Math.max(120, Math.round(numericValue)));
}

function slugifyUpdateValue(value, stripVersionPrefix = false) {
  let normalizedValue = String(value || "").trim();
  if (stripVersionPrefix) {
    normalizedValue = normalizedValue.replace(/^v(?=\d)/i, "");
  }

  try {
    normalizedValue = normalizedValue.normalize("NFKD");
  } catch (error) {
    // Continue with the original string if normalization is unavailable.
  }

  return normalizedValue
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 90);
}

function getUpdateSlugBase(update) {
  const useHeader = update?.hasHeader === true && String(update?.header || "").trim();
  const source = useHeader ? update.header : update?.version;
  return slugifyUpdateValue(source, !useHeader) || "update";
}

function normalizeStoredUpdateSlug(value) {
  return slugifyUpdateValue(value, false);
}

function ensureUniqueUpdateSlugs(updates) {
  const usedSlugs = new Set();

  return updates.map((update, index) => {
    const baseSlug =
      normalizeStoredUpdateSlug(update?.slug) ||
      getUpdateSlugBase(update) ||
      `update-${index + 1}`;
    let slug = baseSlug;
    let suffix = 2;

    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    usedSlugs.add(slug);
    return { ...update, slug };
  });
}

function normalizeUpdate(update, index = 0) {
  const version = String(update?.version || "").trim();
  const date = String(update?.date || "").trim();
  const header = String(update?.header || "").trim();
  const hasHeader = update?.hasHeader === true && header.length > 0;
  const headerImagePath = String(update?.headerImagePath || "").trim();
  const hasHeaderImage = update?.hasHeaderImage === true && headerImagePath.length > 0;
  const headerImageHeight = normalizeHeaderImageHeight(update?.headerImageHeight);
  const isArchived = update?.isArchived === true;
  const rows = Array.isArray(update?.rows)
    ? update.rows.map(normalizeUpdateRow).filter(rowHasContent)
    : [];

  return {
    id: String(update?.id || "").trim() || crypto.randomUUID(),
    slug: normalizeStoredUpdateSlug(update?.slug),
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
  let updates;

  if (Array.isArray(payload?.updates)) {
    updates = payload.updates
      .map(normalizeUpdate)
      .filter((update) => update.version || update.rows.length > 0);
  } else {
    const legacyRows = Array.isArray(payload?.rows)
      ? payload.rows.map(normalizeUpdateRow).filter(rowHasContent)
      : [];

    updates = legacyRows.length
      ? [
          {
            id: crypto.randomUUID(),
            slug: "",
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
      : [];
  }

  return {
    updates: ensureUniqueUpdateSlugs(updates),
  };
}

async function verifyAdminRequest(request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!idToken) {
    return { ok: false, message: "Missing Google ID token." };
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
      return { ok: false, message: "Google account could not be verified." };
    }

    if (!ADMIN_ACCOUNTS.has(email)) {
      return { ok: false, message: "This email is not allowed to edit updates." };
    }

    return { ok: true, email };
  } catch (error) {
    return { ok: false, message: "Google sign-in token is invalid or expired." };
  }
}

export default async function handler(request) {
  const store = getStore({ name: UPDATES_STORE_NAME, consistency: "strong" });

  if (request.method === "GET") {
    const storedState = await store.get(UPDATES_STORE_KEY, { type: "json" });
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
    return json({ error: "Method not allowed." }, 405);
  }

  const auth = await verifyAdminRequest(request);
  if (!auth.ok) {
    return json({ error: auth.message }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ error: "Request body must be valid JSON." }, 400);
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
