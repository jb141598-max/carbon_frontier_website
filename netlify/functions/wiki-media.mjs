import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import {
  createViewer,
  insertAuditEntry,
  json,
  loadAccessState,
  verifyGoogleRequest,
  verifyMutationOrigin,
} from "./_shared/wiki-security.mjs";

const db = getDatabase();
const mediaStore = getStore({ name: "carbon-frontier-wiki-media", consistency: "strong" });
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export const config = {
  path: ["/api/wiki/media", "/api/wiki/media/:id"],
};

function requestedMediaId(request) {
  const url = new URL(request.url);
  const prefix = "/api/wiki/media/";
  const raw = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : url.searchParams.get("id") || "";
  try {
    return decodeURIComponent(raw).trim();
  } catch (error) {
    return "";
  }
}

function safeFileName(value) {
  return String(value || "wiki-image")
    .replace(/[\r\n"\\/]+/g, "-")
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "wiki-image";
}

async function loadViewer(client, account) {
  const state = await loadAccessState(client);
  return { state, viewer: createViewer(state, account) };
}

async function handleGet(request, account) {
  const client = await db.pool.connect();
  try {
    const { viewer } = await loadViewer(client, account);
    if (!viewer.canView) {
      return json({ error: "Wiki not available." }, 403);
    }

    const id = requestedMediaId(request);
    if (!id) {
      if (!viewer.canEdit) {
        return json({ error: "Only wiki editors can browse uploaded media." }, 403);
      }
      const mediaResult = await client.query(
        `SELECT id, original_name, content_type, size_bytes, uploaded_at
         FROM wiki_media
         ORDER BY uploaded_at DESC
         LIMIT 100`
      );
      return json({
        ok: true,
        media: mediaResult.rows.map((item) => ({
          id: item.id,
          originalName: item.original_name,
          contentType: item.content_type,
          sizeBytes: Number(item.size_bytes),
          uploadedAt: new Date(item.uploaded_at).toISOString(),
          url: `/api/wiki/media/${encodeURIComponent(item.id)}`,
        })),
      });
    }

    const mediaResult = await client.query(
      `SELECT id, blob_key, original_name, content_type, size_bytes
       FROM wiki_media
       WHERE id = $1`,
      [id]
    );
    const media = mediaResult.rows[0];
    if (!media) {
      return json({ error: "Wiki image not found." }, 404);
    }
    const data = await mediaStore.get(media.blob_key, { type: "arrayBuffer" });
    if (!data) {
      return json({ error: "Wiki image data is unavailable." }, 404);
    }
    return new Response(data, {
      status: 200,
      headers: {
        "cache-control": "private, max-age=300",
        "content-disposition": `inline; filename="${safeFileName(media.original_name)}"`,
        "content-length": String(media.size_bytes),
        "content-type": media.content_type,
        "x-content-type-options": "nosniff",
      },
    });
  } finally {
    client.release();
  }
}

async function handleUpload(request, account) {
  let form;
  try {
    form = await request.formData();
  } catch (error) {
    return json({ error: "The image upload form could not be read." }, 400);
  }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ error: "Choose an image to upload." }, 400);
  }
  const contentType = String(file.type || "").toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    return json({ error: "Upload a PNG, JPG, WebP, or GIF image." }, 400);
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return json({ error: "Wiki images must be between 1 byte and 4 MB." }, 400);
  }

  const client = await db.pool.connect();
  let blobKey = "";
  let committed = false;
  try {
    await client.query("BEGIN");
    const { state, viewer } = await loadViewer(client, account);
    if (!viewer.canEdit) {
      return json({ error: "This account cannot upload wiki images." }, 403);
    }

    const id = crypto.randomUUID();
    const originalName = safeFileName(file.name);
    blobKey = `images/${id}`;
    const bytes = await file.arrayBuffer();
    await mediaStore.set(blobKey, bytes, {
      metadata: { contentType, originalName, uploadedBy: account.email },
    });
    await client.query(
      `INSERT INTO wiki_media (
         id, blob_key, original_name, content_type, size_bytes, is_private, uploaded_by_email
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, blobKey, originalName, contentType, file.size, state.visibility !== "public", account.email]
    );
    await insertAuditEntry(client, {
      action: "wiki_media_uploaded",
      actorEmail: account.email,
      details: { mediaId: id, originalName, contentType, sizeBytes: file.size },
    });
    await client.query("COMMIT");
    committed = true;
    return json(
      {
        ok: true,
        media: {
          id,
          originalName,
          contentType,
          sizeBytes: file.size,
          url: `/api/wiki/media/${encodeURIComponent(id)}`,
        },
      },
      201
    );
  } finally {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => {});
      if (blobKey) {
        await mediaStore.delete(blobKey).catch(() => {});
      }
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
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }
    if (!verifyMutationOrigin(request)) {
      return json({ error: "Cross-site wiki media request blocked." }, 403);
    }
    const auth = await verifyGoogleRequest(request);
    if (!auth.ok) {
      return json({ error: auth.message }, auth.status);
    }
    return handleUpload(request, auth.account);
  } catch (error) {
    console.error("wiki-media failed", error);
    return json({ error: "The wiki image service could not complete this request." }, 500);
  }
}
