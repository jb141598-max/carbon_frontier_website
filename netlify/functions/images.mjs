import { getStore } from "@netlify/blobs";
import { OAuth2Client } from "google-auth-library";

const ADMIN_ACCOUNTS = new Set(["jb141598@gmail.com", "jb14296@gmail.com"]);
const DEFAULT_GOOGLE_CLIENT_ID =
  "609911855152-3q1n4oiiaaokhq0lrr0blf1bdif6ev6q.apps.googleusercontent.com";
const IMAGE_STORE_NAME = "carbon-frontier-uploaded-images";
const MAX_IMAGE_BYTES = Math.floor(4.5 * 1024 * 1024);

const googleClient = new OAuth2Client();

export const config = {
  path: ["/api/images", "/api/images/:key"],
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

function sanitizeOriginalName(value) {
  return String(value || "image")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "-")
    .trim()
    .slice(0, 180) || "image";
}

function detectImageFormat(bytes) {
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  if (isPng) {
    return { contentType: "image/png", extension: "png" };
  }

  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  if (isJpeg) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }

  const isWebp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";

  if (isWebp) {
    return { contentType: "image/webp", extension: "webp" };
  }

  const gifSignature =
    bytes.length >= 6 ? String.fromCharCode(...bytes.slice(0, 6)) : "";

  if (gifSignature === "GIF87a" || gifSignature === "GIF89a") {
    return { contentType: "image/gif", extension: "gif" };
  }

  return null;
}

async function verifyAdminRequest(request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

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
      return { ok: false, message: "This email is not allowed to upload images." };
    }

    return { ok: true, email };
  } catch (error) {
    return { ok: false, message: "Google sign-in token is invalid or expired." };
  }
}

async function uploadImage(request, store) {
  const auth = await verifyAdminRequest(request);
  if (!auth.ok) {
    return json({ error: auth.message }, 401);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (error) {
    return json({ error: "Upload must use multipart form data." }, 400);
  }

  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ error: "Choose an image file to upload." }, 400);
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return json({ error: "The selected image is empty." }, 400);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return json({ error: "The image is too large. Maximum size is 4.5 MB." }, 413);
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const format = detectImageFormat(bytes);

  if (!format) {
    return json(
      { error: "Only genuine PNG, JPG, WebP, and GIF images are accepted." },
      415
    );
  }

  const key = `${crypto.randomUUID()}.${format.extension}`;
  const originalName = sanitizeOriginalName(file.name);
  const uploadedAt = new Date().toISOString();

  await store.set(key, arrayBuffer, {
    onlyIfNew: true,
    metadata: {
      contentType: format.contentType,
      originalName,
      size: file.size,
      uploadedAt,
      uploadedBy: auth.email,
    },
  });

  return json(
    {
      ok: true,
      key,
      url: `/api/images/${encodeURIComponent(key)}`,
      contentType: format.contentType,
      originalName,
      size: file.size,
      uploadedAt,
    },
    201
  );
}

async function serveImage(request, context, store) {
  const key = String(context?.params?.key || "").trim();
  if (!/^[0-9a-f-]{36}\.(?:png|jpg|webp|gif)$/i.test(key)) {
    return json({ error: "Invalid image key." }, 400);
  }

  const entry = await store.getWithMetadata(key, {
    consistency: "strong",
    type: "arrayBuffer",
  });

  if (!entry) {
    return json({ error: "Image not found." }, 404);
  }

  const contentType = String(entry.metadata?.contentType || "application/octet-stream");
  const headers = {
    "cache-control": "public, max-age=31536000, immutable",
    "content-disposition": "inline",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  };

  if (entry.etag) {
    headers.etag = entry.etag;
  }

  return new Response(request.method === "HEAD" ? null : entry.data, {
    status: 200,
    headers,
  });
}

export default async function handler(request, context) {
  const store = getStore({
    name: IMAGE_STORE_NAME,
    consistency: "strong",
  });

  if (request.method === "POST" && !context?.params?.key) {
    return uploadImage(request, store);
  }

  if ((request.method === "GET" || request.method === "HEAD") && context?.params?.key) {
    return serveImage(request, context, store);
  }

  return json({ error: "Method not allowed." }, 405);
}
