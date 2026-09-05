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
const IMAGE_EXTENSIONS = new Map([
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const SORT_SQL = new Map([
  ["newest", "uploaded_at DESC, id DESC"],
  ["oldest", "uploaded_at ASC, id ASC"],
  ["name", "LOWER(original_name) ASC, uploaded_at DESC"],
]);

export const config = { path: ["/api/wiki/media", "/api/wiki/media/:id"] };

function requestedMediaId(request) {
  const url = new URL(request.url);
  const prefix = "/api/wiki/media/";
  const raw = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : url.searchParams.get("id") || "";
  try { return decodeURIComponent(raw).trim(); } catch { return ""; }
}

export function safeFileName(value) {
  return String(value || "wiki-image")
    .replace(/[\r\n"\\/]+/g, "-")
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "wiki-image";
}

function cleanText(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function cleanTags(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.map((tag) => cleanText(tag, 40).toLowerCase()).filter(Boolean))].slice(0, 10);
}

function cleanSourceUrl(value) {
  const source = cleanText(value, 500);
  if (!source) return "";
  try {
    const url = new URL(source);
    return url.protocol === "https:" ? url.href.slice(0, 500) : "";
  } catch { return ""; }
}

function readMetadata(raw) {
  return {
    title: safeFileName(raw?.title || raw?.originalName),
    description: cleanText(raw?.description, 1000),
    altText: cleanText(raw?.altText, 240),
    defaultCaption: cleanText(raw?.defaultCaption, 300),
    tags: cleanTags(raw?.tags),
    credit: cleanText(raw?.credit, 200),
    sourceUrl: cleanSourceUrl(raw?.sourceUrl),
  };
}

function titleWithImageExtension(value, contentType) {
  const title = safeFileName(value);
  return /\.(?:gif|jpe?g|png|webp)$/i.test(title)
    ? title
    : `${title}${IMAGE_EXTENSIONS.get(contentType) || ""}`.slice(0, 180);
}

function mediaItem(row, viewer, account) {
  return {
    id: row.id,
    originalName: row.original_name,
    title: row.original_name,
    description: row.description || "",
    altText: row.alt_text || "",
    defaultCaption: row.default_caption || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    credit: row.credit || "",
    sourceUrl: row.source_url || "",
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    updatedAt: new Date(row.updated_at || row.uploaded_at).toISOString(),
    uploadedByLabel: account?.email === row.uploaded_by_email ? "You" : "Wiki contributor",
    canEditMetadata: Boolean(
      viewer.isAssignedStaff || (account?.email && account.email === row.uploaded_by_email)
    ),
    url: `/api/wiki/media/${encodeURIComponent(row.id)}`,
  };
}

async function loadViewer(client, account) {
  const state = await loadAccessState(client);
  const viewer = createViewer(state, account);
  viewer.isBlocked = false;
  if (viewer.authenticated && !viewer.isAssignedStaff) {
    const blocked = await client.query(
      `SELECT 1 FROM wiki_blocked_users WHERE email = $1`,
      [account.email]
    );
    if (blocked.rowCount) {
      viewer.canEdit = false;
      viewer.isBlocked = true;
    }
  }
  return { state, viewer };
}

async function handleGet(request, account) {
  const client = await db.pool.connect();
  try {
    const { viewer } = await loadViewer(client, account);
    if (!viewer.canView) return json({ error: "Wiki not available." }, 403);

    const id = requestedMediaId(request);
    if (!id) {
      if (!viewer.canEdit) {
        return json({ error: "Only people who can edit the wiki can browse the image catalog." }, 403);
      }
      const url = new URL(request.url);
      const query = cleanText(url.searchParams.get("q"), 100);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 60));
      const offset = Math.min(10000, Math.max(0, Number(url.searchParams.get("offset")) || 0));
      const sort = SORT_SQL.has(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "newest";
      const pattern = `%${query}%`;
      const where = query
        ? `WHERE original_name ILIKE $1 OR description ILIKE $1 OR alt_text ILIKE $1
                 OR default_caption ILIKE $1 OR credit ILIKE $1
                 OR array_to_string(tags, ' ') ILIKE $1`
        : "";
      const parameters = query ? [pattern, limit, offset] : [limit, offset];
      const limitPosition = query ? 2 : 1;
      const [items, count] = await Promise.all([
        client.query(
          `SELECT id, original_name, description, alt_text, default_caption, tags, credit,
                  source_url, content_type, size_bytes, uploaded_by_email, uploaded_at, updated_at
           FROM wiki_media ${where}
           ORDER BY ${SORT_SQL.get(sort)}
           LIMIT $${limitPosition} OFFSET $${limitPosition + 1}`,
          parameters
        ),
        client.query(
          `SELECT COUNT(*)::INTEGER AS count FROM wiki_media ${where}`,
          query ? [pattern] : []
        ),
      ]);
      const total = Number(count.rows[0]?.count || 0);
      return json({
        ok: true,
        media: items.rows.map((row) => mediaItem(row, viewer, account)),
        pagination: { offset, limit, total, hasMore: offset + items.rowCount < total },
        permissions: { canUpload: viewer.canEdit },
      });
    }

    const result = await client.query(
      `SELECT id, blob_key, original_name, content_type, size_bytes
       FROM wiki_media WHERE id = $1`,
      [id]
    );
    const media = result.rows[0];
    if (!media) return json({ error: "Wiki image not found." }, 404);
    const data = await mediaStore.get(media.blob_key, { type: "arrayBuffer" });
    if (!data) return json({ error: "Wiki image data is unavailable." }, 404);
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
  } finally { client.release(); }
}

async function handleUpload(request, account) {
  let form;
  try { form = await request.formData(); }
  catch { return json({ error: "The image upload form could not be read." }, 400); }
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
  const metadata = readMetadata({
    title: form.get("title") || file.name,
    description: form.get("description"),
    altText: form.get("altText"),
    defaultCaption: form.get("defaultCaption"),
    tags: form.get("tags"),
    credit: form.get("credit"),
    sourceUrl: form.get("sourceUrl"),
  });
  metadata.title = titleWithImageExtension(metadata.title, contentType);

  const client = await db.pool.connect();
  let blobKey = "";
  let committed = false;
  try {
    await client.query("BEGIN");
    const { state, viewer } = await loadViewer(client, account);
    if (!viewer.canEdit) {
      return json({
        error: viewer.isBlocked
          ? "This account is blocked from contributing to the wiki."
          : "This account cannot upload wiki images.",
      }, 403);
    }
    const id = crypto.randomUUID();
    blobKey = `images/${id}`;
    const bytes = await file.arrayBuffer();
    await mediaStore.set(blobKey, bytes, {
      metadata: { contentType, originalName: metadata.title, uploadedBy: account.email },
    });
    await client.query(
      `INSERT INTO wiki_media (
         id, blob_key, original_name, description, alt_text, default_caption, tags,
         credit, source_url, content_type, size_bytes, is_private,
         uploaded_by_email, updated_by_email
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
      [
        id, blobKey, metadata.title, metadata.description, metadata.altText,
        metadata.defaultCaption, metadata.tags, metadata.credit, metadata.sourceUrl,
        contentType, file.size, state.visibility !== "public", account.email,
      ]
    );
    await insertAuditEntry(client, {
      action: "wiki_media_uploaded",
      actorEmail: account.email,
      details: { mediaId: id, title: metadata.title, contentType, sizeBytes: file.size },
    });
    await client.query("COMMIT");
    committed = true;
    const now = new Date();
    const row = {
      id,
      original_name: metadata.title,
      description: metadata.description,
      alt_text: metadata.altText,
      default_caption: metadata.defaultCaption,
      tags: metadata.tags,
      credit: metadata.credit,
      source_url: metadata.sourceUrl,
      content_type: contentType,
      size_bytes: file.size,
      uploaded_by_email: account.email,
      uploaded_at: now,
      updated_at: now,
    };
    return json({ ok: true, media: mediaItem(row, viewer, account) }, 201);
  } finally {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => {});
      if (blobKey) await mediaStore.delete(blobKey).catch(() => {});
    }
    client.release();
  }
}

async function handleUpdate(request, account) {
  const id = requestedMediaId(request);
  if (!id) return json({ error: "Choose an image to update." }, 400);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "The image details could not be read." }, 400); }
  const metadata = readMetadata(body);
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const { viewer } = await loadViewer(client, account);
    if (!viewer.canEdit) return json({ error: "This account cannot edit image details." }, 403);
    const current = await client.query(
      `SELECT uploaded_by_email, content_type FROM wiki_media WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!current.rowCount) return json({ error: "Wiki image not found." }, 404);
    if (!viewer.isAssignedStaff && current.rows[0].uploaded_by_email !== account.email) {
      return json({ error: "Only assigned wiki staff or the uploader can edit these details." }, 403);
    }
    metadata.title = titleWithImageExtension(metadata.title, current.rows[0].content_type);
    const updated = await client.query(
      `UPDATE wiki_media
       SET original_name=$2, description=$3, alt_text=$4, default_caption=$5, tags=$6,
           credit=$7, source_url=$8, updated_by_email=$9, updated_at=NOW()
       WHERE id=$1
       RETURNING id, original_name, description, alt_text, default_caption, tags,
                 credit, source_url, content_type, size_bytes, uploaded_by_email,
                 uploaded_at, updated_at`,
      [
        id, metadata.title, metadata.description, metadata.altText,
        metadata.defaultCaption, metadata.tags, metadata.credit,
        metadata.sourceUrl, account.email,
      ]
    );
    await insertAuditEntry(client, {
      action: "wiki_media_metadata_updated",
      actorEmail: account.email,
      details: { mediaId: id, title: metadata.title },
    });
    await client.query("COMMIT");
    committed = true;
    return json({ ok: true, media: mediaItem(updated.rows[0], viewer, account) });
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

export default async function handler(request) {
  try {
    if (request.method === "GET") {
      const auth = await verifyGoogleRequest(request, { optional: true });
      if (!auth.ok) return json({ error: auth.message }, auth.status);
      return handleGet(request, auth.account);
    }
    if (!["POST", "PATCH"].includes(request.method)) {
      return json({ error: "Method not allowed." }, 405);
    }
    if (!verifyMutationOrigin(request)) {
      return json({ error: "Cross-site wiki media request blocked." }, 403);
    }
    const auth = await verifyGoogleRequest(request);
    if (!auth.ok) return json({ error: auth.message }, auth.status);
    return request.method === "POST"
      ? handleUpload(request, auth.account)
      : handleUpdate(request, auth.account);
  } catch (error) {
    console.error("wiki-media failed", error);
    return json({ error: "The wiki image service could not complete this request." }, 500);
  }
}
