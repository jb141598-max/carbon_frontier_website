import { createHash } from "node:crypto";

// Count *confirmed* current references, not speculative text mentions.
// Dynamic DPL expansions and old revisions are intentionally excluded.
const normalize = (value) => String(value ?? "")
  .trim().replace(/^(?:File|Image)\s*:/i, "").replace(/_/g, " ")
  .replace(/\s+/g, " ").toLowerCase();

function imageMatches(value, media) {
  if (typeof value !== "string" || !value.trim()) return false;
  const raw = value.trim();
  if (raw === String(media.id || "")) return true;
  if (normalize(raw) === normalize(media.original_name || media.title)) return true;
  try {
    const url = new URL(raw, "https://wiki.invalid");
    const match = url.pathname.match(/\/api\/wiki\/media\/([^/]+)$/);
    return Boolean(match && decodeURIComponent(match[1]) === media.id);
  } catch { return false; }
}

const imageFieldName = /(?:^|[_-])(?:image|img|icon|photo|picture|logo|file)$|(?:image|img|icon|photo|picture|logo|file)$/i;

function stripDocs(source) {
  const clean = String(source || "").replace(/<!--[\s\S]*?-->/g, "");
  const only = [...clean.matchAll(/<onlyinclude\b[^>]*>([\s\S]*?)<\/onlyinclude\s*>/gi)];
  if (only.length) return only.map((part) => part[1]).join("");
  const include = [...clean.matchAll(/<includeonly\b[^>]*>([\s\S]*?)<\/includeonly\s*>/gi)];
  if (include.length) return include.map((part) => part[1]).join("");
  return clean.replace(/<noinclude\b[^>]*>[\s\S]*?<\/noinclude\s*>/gi, "");
}

function sourceReferences(source, media) {
  const text = stripDocs(source);
  let count = 0;
  // Direct file markup: [[File:LV Power Pole.png|frameless]].
  const fileMarkup = /\[\[\s*(?:File|Image)\s*:\s*([^|\]\r\n]+)(?:[|\]])/gi;
  for (const match of text.matchAll(fileMarkup)) {
    if (imageMatches(match[1], media)) count += 1;
  }
  // Explicit image-valued template arguments. Other fields (title, text,
  // description) are deliberately ignored to avoid false positives.
  const imageArguments = /(?:^|\||\{\{!\s*\}\})\s*([a-z0-9_-]+)\s*=\s*([^|\}\r\n,]+)/gim;
  for (const match of text.matchAll(imageArguments)) {
    if (imageFieldName.test(match[1]) && imageMatches(match[2], media)) count += 1;
  }
  // Saved static HTML media references from older template markup.
  const mediaHtml = /data-wiki-media-id\s*=\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(mediaHtml)) {
    if (imageMatches(match[1], media)) count += 1;
  }
  return count;
}

function definitionReferences(definition, media, values = {}) {
  if (!definition || typeof definition !== "object") return 0;
  let count = 0;
  if (typeof definition.source === "string") {
    // Substitute simple parameters and defaults before looking for file
    // markup. This avoids counting unused image fields or both the field and
    // the rendered [[File:...]] as two separate placements.
    const resolved = definition.source.replace(
      /\{\{\{\s*([^|{}]+)(?:\|([^{}]*))?\}\}\}/g,
      (original, key, fallback = "") => {
        const normalized = String(key).trim();
        return Object.prototype.hasOwnProperty.call(values, normalized)
          ? String(values[normalized] ?? "") : fallback;
      }
    );
    count += sourceReferences(resolved, media);
  }
  if (Array.isArray(definition.elements)) {
    for (const element of definition.elements) {
      if (element?.type === "image" && imageMatches(element.mediaId, media)) count += 1;
    }
  }
  return count;
}

function isUsedImageParameter(key, definition, values = {}) {
  if (!definition || typeof definition !== "object") return true;
  if (typeof definition.source === "string") {
    const source = stripDocs(definition.source);
    const match = String(key).match(/^(.+?)(\d+)_([A-Za-z0-9_-]+)$/);
    if (!match) return false; // Already counted after parameter substitution.
    const repeated = match[1] + "__N___" + match[3];
    if (!source.includes("{{{" + repeated)) return false;
    const index = Number(match[2]);
    if (index < 1 || index > 100) return false;
    // Only count generated buttons within an explicitly saved repeat count.
    for (const section of source.matchAll(/<cf-repeat\b([^>]*)>/gi)) {
      const attrs = section[1];
      const prefix = attrs.match(/\bprefix=["']([^"']+)["']/i)?.[1];
      if (prefix !== match[1]) continue;
      const countKey = attrs.match(/\bcount=["']([^"']+)["']/i)?.[1];
      const countValue = countKey ? values[countKey] : undefined;
      if (countValue !== undefined && String(countValue).trim() !== "") {
        const amount = Number(countValue);
        return Number.isInteger(amount) && amount >= index;
      }
      return true; // Legacy rows infer the count from populated button values.
    }
    return false;
  }
  return Array.isArray(definition.elements) && definition.elements.some((el) =>
    el?.type === "image-placeholder" && el.placeholderKey === key);
}

function templateIndex(templates) {
  const byId = new Map();
  const bySlug = new Map();
  for (const item of templates) {
    if (item.id) byId.set(item.id, item.definition_json);
    if (item.slug) bySlug.set(normalize(item.slug), item.definition_json);
  }
  return { byId, bySlug };
}

function pageReferences(content, media, index) {
  if (!content || typeof content !== "object") return 0;
  let found = 0;
  const visited = new WeakSet();
  function scan(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 22 || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const child of node) scan(child, depth + 1);
      return;
    }
    if (node.type === "image" || node.type === "image-placeholder") {
      if (imageMatches(node.mediaId, media)) found += 1;
      else if (imageMatches(node.url, media)) found += 1;
    }
    if (node.type === "template") {
      const values = node.values && typeof node.values === "object" ? node.values : {};
      const definition = index.byId.get(node.templateId) ||
        index.bySlug.get(normalize(node.templateSlug)) || node.snapshot;
      found += definitionReferences(definition, media, values);
      for (const [key, value] of Object.entries(values)) {
        if (imageFieldName.test(key) && imageMatches(value, media) &&
            isUsedImageParameter(key, definition, values)) found += 1;
      }
    }
    if (node.type === "wikitext" && typeof node.source === "string") {
      found += sourceReferences(node.source, media);
    }
    // The saved page has blocks and a mirrored wikitext representation. Scan
    // blocks if they exist, never both forms (which would double count).
    if (node.type === "document" && Array.isArray(node.blocks)) {
      if (node.blocks.length) scan(node.blocks, depth + 1);
      else if (typeof node.wikitext?.source === "string") {
        found += sourceReferences(node.wikitext.source, media);
      }
      return;
    }
    // Only document structure, never ordinary prose/metadata.
    for (const key of ["blocks", "children", "items", "rows", "cells"]) {
      if (node[key]) scan(node[key], depth + 1);
    }
  }
  scan(content);
  return found;
}

export function mediaUsageImpact(media, pages = [], templates = []) {
  const index = templateIndex(templates);
  const pageHits = [];
  const templateHits = [];
  let pagePlacements = 0, templateReferences = 0;
  for (const page of pages) {
    const count = pageReferences(page.content_json, media, index);
    if (!count) continue;
    pagePlacements += count;
    pageHits.push({ slug: page.slug, title: page.title, count });
  }
  for (const template of templates) {
    const count = definitionReferences(template.definition_json, media);
    if (!count) continue;
    templateReferences += count;
    templateHits.push({ slug: template.slug, title: template.name, count });
  }
  pageHits.sort((a,b) => a.slug.localeCompare(b.slug));
  templateHits.sort((a,b) => a.slug.localeCompare(b.slug));
  const signature = JSON.stringify({
    mediaId: media.id, imageTitle: media.original_name || media.title,
    pages: pageHits, templates: templateHits
  });
  const version = createHash("sha256").update(signature).digest("hex");
  const mayHaveDynamicReferences = templates.some((entry) =>
    /#dpl\s*:|%PAGE%/i.test(String(entry.definition_json?.source || "")));
  return {
    pageCount: pageHits.length,
    pagePlacements,
    templateCount: templateHits.length,
    templateReferences,
    pages: pageHits.slice(0, 12),
    templates: templateHits.slice(0, 12),
    mayHaveDynamicReferences,
    version
  };
}
