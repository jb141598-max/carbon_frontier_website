(function () {
  "use strict";

  const ENDPOINTS = ["/api/wiki/media", "/.netlify/functions/wiki-media"];
  const DB_NAME = "carbon-frontier-wiki-media-catalog";
  const STORE_NAME = "media";
  const FALLBACK_KEY = "carbon-frontier-wiki-local-media-v1";

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const randomId = () => `local-media-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
  const clean = (value, maximum) => String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
  const title = (value) => clean(value || "wiki-image", 180).replace(/[\r\n"\\/]+/g, "-") || "wiki-image";
  function titleWithExtension(value, contentType) {
    const cleaned = title(value);
    if (/\.(?:gif|jpe?g|png|webp)$/i.test(cleaned)) return cleaned;
    const extension = { "image/gif": ".gif", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[contentType] || "";
    return `${cleaned}${extension}`.slice(0, 180);
  }
  const tags = (value) => [...new Set((Array.isArray(value) ? value : String(value || "").split(","))
    .map((tag) => clean(tag, 40).toLowerCase()).filter(Boolean))].slice(0, 10);
  function sourceUrl(value) {
    const raw = clean(value, 500);
    if (!raw) return "";
    try { const parsed = new URL(raw); return parsed.protocol === "https:" ? parsed.href : ""; }
    catch { return ""; }
  }
  function metadata(raw = {}) {
    return {
      title: title(raw.title || raw.originalName),
      originalName: title(raw.title || raw.originalName),
      description: clean(raw.description, 1000),
      altText: clean(raw.altText, 240),
      defaultCaption: clean(raw.defaultCaption, 300),
      tags: tags(raw.tags),
      credit: clean(raw.credit, 200),
      sourceUrl: sourceUrl(raw.sourceUrl),
    };
  }
  function snapshotItems() {
    const items = window.CarbonFrontierTestingSync?.getSection("wiki")?.media;
    return Array.isArray(items) ? clone(items) : [];
  }
  function endpoint(base, id = "", query = {}) {
    const url = new URL(base, location.origin);
    if (id) {
      if (base.startsWith("/api/")) url.pathname += `/${encodeURIComponent(id)}`;
      else url.searchParams.set("id", id);
    }
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    return `${url.pathname}${url.search}`;
  }
  function openDatabase() {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }
  async function databaseAction(mode, action) {
    const db = await openDatabase();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }
  function fallbackRead() {
    try { const value = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]"); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function fallbackWrite(items) { localStorage.setItem(FALLBACK_KEY, JSON.stringify(items)); }
  async function localAll() {
    const stored = await databaseAction("readonly", (store) => store.getAll());
    return stored || fallbackRead();
  }
  async function localGet(id) {
    const stored = await databaseAction("readonly", (store) => store.get(id));
    return stored || fallbackRead().find((item) => item.id === id) || null;
  }
  async function localPut(item) {
    const result = await databaseAction("readwrite", (store) => store.put(item));
    if (result !== null) return;
    const items = fallbackRead();
    const index = items.findIndex((entry) => entry.id === item.id);
    const fallback = { ...item };
    if (fallback.blob) {
      fallback.dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("The local image could not be read."));
        reader.readAsDataURL(fallback.blob);
      });
      delete fallback.blob;
    }
    if (index >= 0) items[index] = fallback; else items.push(fallback);
    fallbackWrite(items);
  }
  function publicItem(item) {
    const { blob, dataUrl, ...safe } = item;
    return safe;
  }

  function create({ testing = false, fetcher = fetch } = {}) {
    let preferredEndpoint = "";
    async function remote({ id = "", query = {}, method = "GET", body = null } = {}) {
      let lastError = new Error("The wiki image service is unavailable.");
      const bases = preferredEndpoint
        ? [preferredEndpoint, ...ENDPOINTS.filter((item) => item !== preferredEndpoint)]
        : ENDPOINTS;
      for (const base of bases) {
        try {
          const response = await fetcher(endpoint(base, id, query), { method, body, cache: "no-store" });
          const payload = await response.json().catch(() => null);
          if (response.status === 404 && base.startsWith("/api/") && !id) {
            lastError = new Error(payload?.error || "Image catalog service not found.");
            continue;
          }
          if (!response.ok) {
            const error = new Error(payload?.error || `Image catalog request failed (${response.status}).`);
            error.status = response.status;
            throw error;
          }
          preferredEndpoint = base;
          return payload;
        } catch (error) {
          lastError = error;
          if (error?.status && error.status !== 404) throw error;
        }
      }
      throw lastError;
    }
    async function list({ query = "", sort = "newest", offset = 0, limit = 60 } = {}) {
      if (!testing) return remote({ query: { q: query, sort, offset, limit } });
      const local = await localAll();
      const merged = new Map(snapshotItems().map((item) => [item.id, item]));
      local.forEach((item) => merged.set(item.id, publicItem(item)));
      const needle = clean(query, 100).toLowerCase();
      let items = [...merged.values()].filter((item) => !needle || [
        item.title, item.originalName, item.description, item.altText,
        item.defaultCaption, item.credit, ...(item.tags || []),
      ].some((value) => String(value || "").toLowerCase().includes(needle)));
      items.sort((left, right) => sort === "name"
        ? String(left.title || left.originalName).localeCompare(String(right.title || right.originalName))
        : (new Date(left.uploadedAt) - new Date(right.uploadedAt)) * (sort === "oldest" ? 1 : -1));
      const total = items.length;
      items = items.slice(offset, offset + limit);
      return { ok: true, media: items, pagination: { offset, limit, total, hasMore: offset + items.length < total }, permissions: { canUpload: true } };
    }
    async function upload(file, raw = {}) {
      const details = metadata({ ...raw, title: raw.title || file.name });
      details.title = details.originalName = titleWithExtension(details.title, file.type);
      if (!testing) {
        const form = new FormData();
        form.append("file", file);
        Object.entries(details).forEach(([key, value]) => form.append(key, Array.isArray(value) ? value.join(",") : value));
        return remote({ method: "POST", body: form });
      }
      const now = new Date().toISOString();
      const item = {
        id: randomId(), ...details, contentType: file.type, sizeBytes: file.size,
        uploadedAt: now, updatedAt: now, uploadedByLabel: "You",
        canEditMetadata: true, url: "", blob: file,
      };
      await localPut(item);
      return { ok: true, media: publicItem(item) };
    }
    async function update(id, raw) {
      const details = metadata(raw);
      if (!testing) return remote({ id, method: "PATCH", body: JSON.stringify(details) });
      const current = await localGet(id) || snapshotItems().find((item) => item.id === id);
      if (!current) throw new Error("Wiki image not found.");
      details.title = details.originalName = titleWithExtension(details.title, current.contentType);
      const item = { ...current, ...details, id, updatedAt: new Date().toISOString(), canEditMetadata: true };
      await localPut(item);
      return { ok: true, media: publicItem(item) };
    }
    async function getBlob(id) {
      if (testing) {
        const item = await localGet(id);
        if (item?.blob) return item.blob;
        if (item?.dataUrl) return (await fetch(item.dataUrl)).blob();
        const live = await window.CarbonFrontierTestingSync?.fetchLiveWikiMedia?.(id);
        if (live) return live;
        throw new Error("Refresh Live Data or import this image into the local catalog first.");
      }
      for (const base of ENDPOINTS) {
        const response = await fetcher(endpoint(base, id), { cache: "no-store" });
        if (response.status === 404 && base.startsWith("/api/")) continue;
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Image request failed (${response.status}).`);
        }
        return response.blob();
      }
      throw new Error("The wiki image could not be loaded.");
    }
    return Object.freeze({ list, upload, update, getBlob });
  }

  window.CarbonFrontierWikiMedia = Object.freeze({ create, metadata });
})();
