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

let databaseInstance;
let mediaStoreInstance;
function database() {
  databaseInstance ||= getDatabase();
  return databaseInstance;
}
function wikiMediaStore() {
  mediaStoreInstance ||= getStore({ name: "carbon-frontier-wiki-media", consistency: "strong" });
  return mediaStoreInstance;
}
const MAX_PREVIEW_PAGES = 2000;
const MAX_IMPORT_PAGES = 8;
const MAX_IMAGES_PER_BATCH = 24;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_BYTES = 250_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export const config = { path: "/api/wiki/import" };

function cleanTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function sourceTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 255);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function safeFileName(value) {
  return String(value || "imported-image")
    .replace(/[\r\n"\\/]+/g, "-")
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "imported-image";
}

function sourceConfig(value) {
  try {
    const url = new URL(String(value || "").trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(hostname === "miraheze.org" || hostname.endsWith(".miraheze.org"))) {
      return null;
    }
    return {
      origin: url.origin,
      hostname,
      apiUrl: new URL("/w/api.php", url.origin),
    };
  } catch (error) {
    return null;
  }
}

async function mediaWikiRequest(source, parameters) {
  const url = new URL(source.apiUrl);
  Object.entries({ action: "query", format: "json", formatversion: "2", ...parameters })
    .forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    headers: { "user-agent": "CarbonFrontierWikiImporter/1.0 (wiki migration tool)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Miraheze returned ${response.status} while loading wiki data.`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error.info || payload.error.code || "The Miraheze API rejected the request.");
  }
  return payload;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatInline(value) {
  const replacements = [];
  let text = String(value || "");
  const token = (html) => {
    const id = `MIGRATIONTOKEN${replacements.length}X`;
    replacements.push([id, html]);
    return id;
  };

  text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, label) => {
    const slug = slugify(target);
    const safeLabel = escapeHtml(cleanTitle(label || target));
    return slug ? token(`<a href="/wiki/${encodeURIComponent(slug)}">${safeLabel}</a>`) : safeLabel;
  });
  text = text.replace(/\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/g, (_match, address, label) => {
    const safeAddress = escapeHtml(address);
    const safeLabel = escapeHtml(String(label || address).trim());
    return token(`<a href="${safeAddress}" rel="noopener noreferrer">${safeLabel}</a>`);
  });
  text = escapeHtml(text);
  text = text
    .replace(/&#039;&#039;&#039;&#039;&#039;(.+?)&#039;&#039;&#039;&#039;&#039;/g, "<strong><em>$1</em></strong>")
    .replace(/&#039;&#039;&#039;(.+?)&#039;&#039;&#039;/g, "<strong>$1</strong>")
    .replace(/&#039;&#039;(.+?)&#039;&#039;/g, "<em>$1</em>");
  replacements.forEach(([id, html]) => {
    text = text.replaceAll(id, html);
  });
  return text;
}

function normalizeTemplateIdentifier(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^template\s*:/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizedParameterKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function templatePlaceholders(definition) {
  const seen = new Set();
  return (Array.isArray(definition?.elements) ? definition.elements : [])
    .filter((element) => ["placeholder", "image-placeholder"].includes(element?.type))
    .map((element) => ({
      key: String(element.placeholderKey || "").trim(),
      kind: element.type === "image-placeholder" ? "image" : "text",
    }))
    .filter((placeholder) => {
      const normalized = normalizedParameterKey(placeholder.key);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function parseMirahezeTemplateInvocation(raw) {
  const source = String(raw || "").trim();
  if (!source.startsWith("{{") || !source.endsWith("}}")) return null;
  const inner = source.slice(2, -2).trim();
  const nameMatch = inner.match(/^([^|]*?)(?=\s+[A-Za-z][A-Za-z0-9_-]*\s*=|\||$)/);
  const name = cleanTitle(nameMatch?.[1] || "").replace(/^Template\s*:/i, "");
  if (!name) return null;
  const parameterSource = inner.slice(nameMatch[0].length).replace(/^\s*\|?\s*/, "");
  const matches = [];
  const pattern = /(?:^|[|\s])([A-Za-z][A-Za-z0-9_-]*)\s*=/g;
  let match;
  while ((match = pattern.exec(parameterSource))) {
    matches.push({
      key: match[1],
      start: match.index,
      valueStart: pattern.lastIndex,
    });
  }
  const parameters = {};
  matches.forEach((item, index) => {
    const end = matches[index + 1]?.start ?? parameterSource.length;
    const value = parameterSource.slice(item.valueStart, end).replace(/[|\s]+$/g, "").trim();
    parameters[item.key] = value.slice(0, 1000);
  });
  return { name, parameters, raw: source };
}

function topLevelTemplateInvocations(wikitext) {
  const source = String(wikitext || "");
  const calls = [];
  let depth = 0;
  let start = -1;
  for (let index = 0; index < source.length - 1; index += 1) {
    const pair = source.slice(index, index + 2);
    if (pair === "{{") {
      if (depth === 0) start = index;
      depth += 1;
      index += 1;
    } else if (pair === "}}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const end = index + 2;
        const invocation = parseMirahezeTemplateInvocation(source.slice(start, end));
        if (invocation) calls.push({ ...invocation, start, end });
        start = -1;
      }
      index += 1;
    }
  }
  return calls.slice(0, 100);
}

function templateIndex(templates) {
  const index = new Map();
  for (const template of Array.isArray(templates) ? templates : []) {
    [template.name, template.slug].forEach((candidate) => {
      const key = normalizeTemplateIdentifier(candidate);
      if (key && !index.has(key)) index.set(key, template);
    });
  }
  return index;
}

function matchingTemplate(invocation, templates) {
  return templateIndex(templates).get(normalizeTemplateIdentifier(invocation?.name)) || null;
}

function normalizedFileTitle(value) {
  const cleaned = String(value || "")
    .replace(/^\[\[(?:File|Image):/i, "")
    .replace(/\]\]$/g, "")
    .split("|")[0]
    .replace(/^File:/i, "")
    .trim()
    .replaceAll("_", " ");
  return cleaned ? `File:${cleaned}` : "";
}

function templateImageReferences(wikitext, templates) {
  const references = [];
  for (const invocation of topLevelTemplateInvocations(wikitext)) {
    const template = matchingTemplate(invocation, templates);
    if (!template) continue;
    const parameters = new Map(Object.entries(invocation.parameters)
      .map(([key, value]) => [normalizedParameterKey(key), value]));
    for (const placeholder of template.placeholders || templatePlaceholders(template.currentRevision?.definition)) {
      if (placeholder.kind !== "image") continue;
      const value = parameters.get(normalizedParameterKey(placeholder.key));
      const fileTitle = normalizedFileTitle(value);
      if (fileTitle) references.push({ fileTitle, alt: fileTitle.slice(5), caption: "" });
    }
  }
  return references;
}

function imageReferences(wikitext, templates = []) {
  const references = [];
  const pattern = /\[\[(?:File|Image):([^|\]]+)(?:\|([^\]]*))?\]\]/gi;
  String(wikitext || "").replace(pattern, (_match, name, options = "") => {
    const parts = String(options).split("|").map((part) => part.trim()).filter(Boolean);
    const caption = parts.findLast?.((part) =>
      !/^(?:thumb|thumbnail|frame|frameless|left|right|center|none|upright(?:=[\d.]+)?|\d+px)$/i.test(part)
    ) || "";
    references.push({
      fileTitle: `File:${String(name).trim().replaceAll("_", " ")}`,
      alt: caption || String(name).replace(/\.[^.]+$/, "").replaceAll("_", " "),
      caption,
    });
    return _match;
  });
  references.push(...templateImageReferences(wikitext, templates));
  const unique = new Map();
  references.forEach((reference) => {
    const key = reference.fileTitle.toLowerCase();
    if (!unique.has(key)) unique.set(key, reference);
  });
  return [...unique.values()].slice(0, MAX_IMAGES_PER_BATCH);
}

function extractCategories(wikitext) {
  const categories = [];
  String(wikitext || "").replace(/\[\[Category:([^|\]]+)(?:\|[^\]]*)?\]\]/gi, (_match, name) => {
    const cleaned = cleanTitle(name).slice(0, 80);
    if (cleaned && !categories.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      categories.push(cleaned);
    }
    return "";
  });
  return categories;
}

function stripMigrationMarkup(wikitext) {
  return String(wikitext || "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<ref\b[^>]*>[^]*?<\/ref\s*>/gi, "")
    .replace(/<ref\b[^>]*\/\s*>/gi, "")
    .replace(/__\w+__/g, "")
    .replace(/\[\[Category:[^\]]+\]\]/gi, "");
}

function templateBlock(invocation, template, importedMedia) {
  const parameters = new Map(Object.entries(invocation.parameters)
    .map(([key, value]) => [normalizedParameterKey(key), String(value || "").trim()]));
  const placeholders = template.placeholders || templatePlaceholders(template.currentRevision?.definition);
  const values = {};
  for (const placeholder of placeholders) {
    const rawValue = parameters.get(normalizedParameterKey(placeholder.key));
    if (rawValue === undefined) continue;
    if (placeholder.kind === "image") {
      const fileTitle = normalizedFileTitle(rawValue);
      const media = importedMedia.get(fileTitle.toLowerCase());
      values[placeholder.key] = media?.id || "";
    } else {
      values[placeholder.key] = rawValue.slice(0, 1000);
    }
  }
  return {
    id: crypto.randomUUID(),
    type: "template",
    templateId: template.id,
    templateSlug: template.slug,
    templateRevisionId: template.currentRevision?.id || "",
    values,
    snapshot: template.currentRevision?.definition || null,
  };
}

function tokenizeKnownTemplates(source, templates, importedMedia, templateTokens) {
  const calls = topLevelTemplateInvocations(source);
  if (!calls.length || !templates.length) return source;
  let output = "";
  let cursor = 0;
  for (const invocation of calls) {
    const template = matchingTemplate(invocation, templates);
    if (!template) continue;
    output += source.slice(cursor, invocation.start);
    const token = `@@CFTEMPLATE${templateTokens.length}@@`;
    templateTokens.push(templateBlock(invocation, template, importedMedia));
    output += `\n${token}\n`;
    cursor = invocation.end;
  }
  return `${output}${source.slice(cursor)}`;
}

export function convertWikitextToDocument(wikitext, importedMedia = new Map(), templates = []) {
  const source = stripMigrationMarkup(wikitext);
  const imageTokens = [];
  const templateTokens = [];
  const withTemplateTokens = tokenizeKnownTemplates(source, templates, importedMedia, templateTokens);
  const withTokens = withTemplateTokens.replace(/\[\[(?:File|Image):([^|\]]+)(?:\|([^\]]*))?\]\]/gi, (_match, name, options = "") => {
    const fileTitle = `File:${String(name).trim().replaceAll("_", " ")}`;
    const media = importedMedia.get(fileTitle.toLowerCase());
    const parts = String(options).split("|").map((part) => part.trim()).filter(Boolean);
    const caption = parts.findLast?.((part) =>
      !/^(?:thumb|thumbnail|frame|frameless|left|right|center|none|upright(?:=[\d.]+)?|\d+px)$/i.test(part)
    ) || "";
    const token = `@@CFIMAGE${imageTokens.length}@@`;
    imageTokens.push(media ? {
      id: crypto.randomUUID(),
      type: "image",
      mediaId: media.id,
      url: `/api/wiki/media/${encodeURIComponent(media.id)}`,
      alt: cleanTitle(caption || name).slice(0, 240),
      caption: cleanTitle(caption).slice(0, 300),
      layout: /\bright\b/i.test(options) ? "wrap-right" : /\bleft\b/i.test(options) ? "wrap-left" : "inline",
      widthPercent: 72,
      xPercent: 0,
      yPixels: 0,
    } : {
      id: crypto.randomUUID(),
      type: "paragraph",
      text: `[Image from Miraheze: ${String(name).trim()}]`,
    });
    return `\n${token}\n`;
  });

  const blocks = [];
  let paragraphLines = [];
  let listType = "";
  let listItems = [];
  const flushParagraph = () => {
    const text = paragraphLines.join(" ").trim();
    if (text) {
      blocks.push({ id: crypto.randomUUID(), type: "paragraph", html: formatInline(text), text });
    }
    paragraphLines = [];
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({
        id: crypto.randomUUID(),
        type: listType,
        items: listItems.map((item) => ({ html: formatInline(item), text: item })),
      });
    }
    listType = "";
    listItems = [];
  };

  for (const rawLine of withTokens.split(/\r?\n/)) {
    const line = rawLine.trim();
    const imageMatch = line.match(/^@@CFIMAGE(\d+)@@$/);
    if (imageMatch) {
      flushParagraph();
      flushList();
      const imageBlock = imageTokens[Number(imageMatch[1])];
      if (imageBlock) blocks.push(imageBlock);
      continue;
    }
    const templateMatch = line.match(/^@@CFTEMPLATE(\d+)@@$/);
    if (templateMatch) {
      flushParagraph();
      flushList();
      const block = templateTokens[Number(templateMatch[1])];
      if (block) blocks.push(block);
      continue;
    }
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(={2,4})\s*(.*?)\s*\1$/);
    if (heading) {
      flushParagraph();
      flushList();
      const text = heading[2].trim();
      blocks.push({
        id: crypto.randomUUID(),
        type: heading[1].length === 2 ? "heading2" : "heading3",
        html: formatInline(text),
        text,
      });
      continue;
    }
    const list = line.match(/^([*#])\s*(.+)$/);
    if (list) {
      flushParagraph();
      const nextType = list[1] === "*" ? "bullet-list" : "numbered-list";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push(list[2].replace(/^[*#]+\s*/, ""));
      continue;
    }
    if (/^(?:\{\||\|-|\|\})/.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }
    paragraphLines.push(line.replace(/^[!|]+\s*/, "").replace(/\s*(?:!!|\|\|)\s*/g, " · "));
  }
  flushParagraph();
  flushList();
  return {
    type: "document",
    version: 3,
    blocks: blocks.length
      ? blocks
      : [{ id: crypto.randomUUID(), type: "paragraph", text: "This imported page did not contain readable article text." }],
  };
}

async function requireManager(request) {
  const auth = await verifyGoogleRequest(request);
  if (!auth.ok) return { response: json({ error: auth.message }, auth.status) };
  const client = await database().pool.connect();
  try {
    const state = await loadAccessState(client);
    const viewer = createViewer(state, auth.account);
    if (!viewer.canManageSettings) {
      return { response: json({ error: "Only wiki owners and admins can import a Miraheze wiki." }, 403) };
    }
    return { account: auth.account };
  } finally {
    client.release();
  }
}

async function previewImport(source) {
  const pages = [];
  let continuation = "";
  do {
    const payload = await mediaWikiRequest(source, {
      list: "allpages",
      apnamespace: 0,
      aplimit: "max",
      ...(continuation ? { apcontinue: continuation } : {}),
    });
    (payload?.query?.allpages || []).forEach((page) => {
      if (pages.length < MAX_PREVIEW_PAGES) {
        pages.push({ pageId: page.pageid, title: sourceTitle(page.title), slug: slugify(page.title) });
      }
    });
    continuation = payload?.continue?.apcontinue || "";
  } while (continuation && pages.length < MAX_PREVIEW_PAGES);
  return json({
    ok: true,
    source: source.origin,
    pages,
    truncated: Boolean(continuation),
    limit: MAX_PREVIEW_PAGES,
  });
}

async function loadPageSources(source, titles) {
  const payload = await mediaWikiRequest(source, {
    prop: "revisions",
    titles: titles.join("|"),
    rvprop: "content|timestamp|user|comment",
    rvslots: "main",
  });
  return (payload?.query?.pages || []).filter((page) => !page.missing).map((page) => {
    const revision = page.revisions?.[0] || {};
    const wikitext = revision.slots?.main?.content ?? revision.content ?? "";
    return {
      title: sourceTitle(page.title),
      wikitext: String(wikitext || ""),
      sourceUser: cleanTitle(revision.user || "Unknown editor"),
      sourceTimestamp: revision.timestamp || null,
      sourceComment: cleanTitle(revision.comment || ""),
    };
  });
}

async function loadImageInfo(source, references) {
  const titles = [...new Set(references.map((item) => item.fileTitle))].slice(0, MAX_IMAGES_PER_BATCH);
  if (!titles.length) return [];
  const payload = await mediaWikiRequest(source, {
    prop: "imageinfo",
    titles: titles.join("|"),
    iiprop: "url|mime|size",
    iilimit: 1,
  });
  return (payload?.query?.pages || []).map((page) => ({
    title: String(page.title || ""),
    ...(page.imageinfo?.[0] || {}),
  })).filter((item) => item.url);
}

async function loadCarbonFrontierTemplates() {
  const client = await database().pool.connect();
  try {
    const result = await client.query(
      `SELECT t.id, t.slug, t.name,
              r.id AS revision_id, r.revision_number, r.definition_json
       FROM wiki_templates t
       INNER JOIN wiki_template_revisions r ON r.id = t.current_revision_id
       WHERE t.is_deleted = FALSE
       ORDER BY t.name ASC`
    );
    return result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      currentRevision: {
        id: row.revision_id,
        number: Number(row.revision_number),
        definition: row.definition_json,
      },
      placeholders: templatePlaceholders(row.definition_json),
    }));
  } finally {
    client.release();
  }
}

async function importRemoteImage(client, account, sourceHostname, info, createdBlobKeys) {
  const reportedType = String(info.mime || "").toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(reportedType) || Number(info.size) > MAX_IMAGE_BYTES) return null;
  const url = new URL(info.url);
  if (url.protocol !== "https:") return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const contentType = String(response.headers.get("content-type") || reportedType).split(";")[0].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType) || bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  const id = crypto.randomUUID();
  const blobKey = `images/${id}`;
  const originalName = safeFileName(String(info.title || "").replace(/^File:/i, ""));
  await wikiMediaStore().set(blobKey, bytes, {
    metadata: { contentType, originalName, uploadedBy: "system", importedFrom: sourceHostname },
  });
  createdBlobKeys.push(blobKey);
  await client.query(
    `INSERT INTO wiki_media (
       id, blob_key, original_name, content_type, size_bytes, is_private, uploaded_by_email
     ) VALUES ($1, $2, $3, $4, $5, TRUE, 'system')`,
    [id, blobKey, originalName, contentType, bytes.byteLength]
  );
  await insertAuditEntry(client, {
    action: "miraheze_image_imported",
    actorEmail: account.email,
    details: { mediaId: id, originalName, sourceWiki: sourceHostname },
  });
  return { id, title: info.title };
}

async function syncCategories(client, pageId, categories) {
  await client.query(`DELETE FROM wiki_page_categories WHERE page_id = $1`, [pageId]);
  for (const name of categories) {
    const slug = slugify(name).slice(0, 80);
    if (!slug) continue;
    await client.query(
      `INSERT INTO wiki_categories (id, slug, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO NOTHING`,
      [crypto.randomUUID(), slug, name]
    );
    await client.query(
      `INSERT INTO wiki_page_categories (page_id, category_id)
       SELECT $1, id FROM wiki_categories WHERE slug = $2
       ON CONFLICT DO NOTHING`,
      [pageId, slug]
    );
  }
}

async function importPage(client, account, source, page, importedMedia, templates, options) {
  const title = cleanTitle(page.title);
  const slug = options.mapMainPage && title.toLowerCase() === "main page" ? "front-page" : slugify(title);
  if (!title || !slug) return { title, status: "failed", message: "The page title could not become a valid address." };
  const redirect = page.wikitext.match(/^\s*#redirect\s*\[\[([^\]|#]+)/i);
  if (redirect) {
    return { title, slug, status: "redirect", targetSlug: slugify(redirect[1]) };
  }

  const existingResult = await client.query(
    `SELECT p.id, p.is_deleted, r.revision_number
     FROM wiki_pages p
     LEFT JOIN wiki_revisions r ON r.id = p.current_revision_id
     WHERE p.slug = $1
     FOR UPDATE OF p`,
    [slug]
  );
  const existing = existingResult.rows[0];
  if (existing && options.conflictMode === "skip" && slug !== "front-page") {
    return { title, slug, status: "skipped", message: "A page already uses this address." };
  }
  if (existing?.is_deleted) {
    return { title, slug, status: "skipped", message: "A trashed page already uses this address." };
  }
  const pageId = existing?.id || crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const revisionNumber = existing ? Number(existing.revision_number || 0) + 1 : 1;
  const document = convertWikitextToDocument(page.wikitext, importedMedia, templates);
  const matchedTemplates = document.blocks.filter((block) => block.type === "template").length;
  const serializedDocument = JSON.stringify(document);
  if (new TextEncoder().encode(serializedDocument).length > MAX_CONTENT_BYTES) {
    return { title, slug, status: "failed", message: "The converted page is larger than the 250 KB article limit." };
  }
  const importedBy = `Imported from ${source.hostname} · ${page.sourceUser}`.slice(0, 180);
  if (!existing) {
    await client.query(
      `INSERT INTO wiki_pages (
         id, slug, title, allow_normal_edits, created_by_email, updated_by_email
       ) VALUES ($1, $2, $3, TRUE, 'system', 'system')`,
      [pageId, slug, title]
    );
  }
  await client.query(
    `INSERT INTO wiki_revisions (
       id, page_id, revision_number, page_title, content_json, edit_summary,
       author_email, author_name, author_role
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'system', $7, 'contributor')`,
    [
      revisionId,
      pageId,
      revisionNumber,
      title,
      serializedDocument,
      `Import current revision from ${source.hostname}`.slice(0, 300),
      importedBy,
    ]
  );
  await client.query(
    `UPDATE wiki_pages
     SET title = $1, current_revision_id = $2, updated_at = NOW(), updated_by_email = 'system'
     WHERE id = $3`,
    [title, revisionId, pageId]
  );
  await syncCategories(client, pageId, extractCategories(page.wikitext));
  await insertAuditEntry(client, {
    action: existing ? "miraheze_page_updated" : "miraheze_page_imported",
    actorEmail: account.email,
    pageId,
    details: {
      sourceWiki: source.hostname,
      sourceTitle: page.title,
      sourceUser: page.sourceUser,
      sourceTimestamp: page.sourceTimestamp,
      slug,
      revisionNumber,
    },
  });
  return { title, slug, status: existing ? "updated" : "imported", revisionNumber, matchedTemplates };
}

async function createRedirect(client, account, source, item) {
  if (!item.slug || !item.targetSlug || item.slug === "front-page" || item.slug === item.targetSlug) {
    return { ...item, status: "skipped", message: "The redirect address was invalid." };
  }
  const target = await client.query(
    `SELECT id FROM wiki_pages WHERE slug = $1 AND is_deleted = FALSE`,
    [item.targetSlug]
  );
  if (!target.rowCount) return { ...item, status: "skipped", message: "The redirect target has not been imported yet." };
  const pageConflict = await client.query(`SELECT 1 FROM wiki_pages WHERE slug = $1`, [item.slug]);
  if (pageConflict.rowCount) return { ...item, status: "skipped", message: "A page already uses the redirect address." };
  await client.query(
    `INSERT INTO wiki_redirects (source_slug, target_page_id, created_by_email)
     VALUES ($1, $2, 'system')
     ON CONFLICT (source_slug) DO UPDATE
     SET target_page_id = EXCLUDED.target_page_id, created_by_email = 'system', created_at = NOW()`,
    [item.slug, target.rows[0].id]
  );
  await insertAuditEntry(client, {
    action: "miraheze_redirect_imported",
    actorEmail: account.email,
    pageId: target.rows[0].id,
    details: { sourceWiki: source.hostname, sourceSlug: item.slug, targetSlug: item.targetSlug },
  });
  return { ...item, status: "imported_redirect" };
}

async function runImport(source, account, body) {
  const titles = [...new Set((Array.isArray(body?.titles) ? body.titles : []).map(sourceTitle).filter(Boolean))];
  if (!titles.length || titles.length > MAX_IMPORT_PAGES) {
    return json({ error: `Import between 1 and ${MAX_IMPORT_PAGES} pages per batch.` }, 400);
  }
  const conflictMode = body?.conflictMode === "new_revision" ? "new_revision" : "skip";
  const options = { conflictMode, mapMainPage: body?.mapMainPage !== false };
  const pages = await loadPageSources(source, titles);
  const templates = await loadCarbonFrontierTemplates();
  const references = pages.flatMap((page) => imageReferences(page.wikitext, templates));
  const imageInfo = await loadImageInfo(source, references);
  const client = await database().pool.connect();
  const createdBlobKeys = [];
  let committed = false;
  try {
    await client.query("BEGIN");
    const importedMedia = new Map();
    for (const info of imageInfo) {
      const imported = await importRemoteImage(client, account, source.hostname, info, createdBlobKeys);
      if (imported) importedMedia.set(imported.title.toLowerCase(), imported);
    }
    const results = [];
    const redirects = [];
    for (const page of pages) {
      const result = await importPage(client, account, source, page, importedMedia, templates, options);
      if (result.status === "redirect") redirects.push(result);
      else results.push(result);
    }
    for (const redirect of redirects) {
      results.push(await createRedirect(client, account, source, redirect));
    }
    await client.query("COMMIT");
    committed = true;
    return json({
      ok: true,
      source: source.origin,
      results,
      importedImages: importedMedia.size,
      matchedTemplates: results.reduce((total, item) => total + Number(item.matchedTemplates || 0), 0),
      requested: titles.length,
    });
  } finally {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => {});
      await Promise.all(createdBlobKeys.map((key) => wikiMediaStore().delete(key).catch(() => {})));
    }
    client.release();
  }
}

export default async function handler(request) {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!verifyMutationOrigin(request)) return json({ error: "Cross-site wiki import request blocked." }, 403);
    const manager = await requireManager(request);
    if (manager.response) return manager.response;
    const body = await request.json().catch(() => null);
    const source = sourceConfig(body?.sourceUrl);
    if (!source) {
      return json({ error: "Enter an HTTPS Miraheze address ending in .miraheze.org." }, 400);
    }
    if (body?.action === "preview") return previewImport(source);
    if (body?.action === "import") return runImport(source, manager.account, body);
    return json({ error: "Choose preview or import." }, 400);
  } catch (error) {
    console.error("wiki-import failed", error);
    return json({ error: error?.message || "The Miraheze import could not be completed." }, 500);
  }
}
