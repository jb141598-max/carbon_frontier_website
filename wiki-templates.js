(function () {
  "use strict";

  const AUTH_STORAGE_KEY = "carbon-frontier-google-session-v1";
  const LOCAL_TEMPLATES_KEY = "carbon-frontier-wiki-local-templates-v1";
  const ACCESS_ENDPOINTS = ["/api/wiki-access", "/.netlify/functions/wiki-access"];
  const TEMPLATE_ENDPOINTS = ["/api/wiki/templates", "/.netlify/functions/wiki-templates"];
  const MEDIA_ENDPOINTS = ["/api/wiki/media", "/.netlify/functions/wiki-media"];
  const PAGE_ENDPOINTS = ["/api/wiki/pages", "/.netlify/functions/wiki-pages"];
  const CURSOR_ACCOUNT = { email: "jb141598@gmail.com", name: "Cursor Testing Owner", idToken: "" };
  const FONT_FAMILIES = new Set(["Play", "Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"]);
  const ELEMENT_TYPES = new Set(["text", "placeholder", "image-placeholder", "shape", "frame", "line", "image"]);
  const SHAPES = new Set(["rectangle", "rounded", "ellipse", "triangle", "diamond"]);
  const templateWikitext = window.CarbonFrontierTemplateWikitext;

  const ui = {
    accountPill: document.getElementById("account-pill"),
    loadingView: document.getElementById("loading-view"),
    unavailableView: document.getElementById("unavailable-view"),
    unavailableCopy: document.getElementById("unavailable-copy"),
    signinSlot: document.getElementById("google-signin-slot"),
    view: document.getElementById("templates-view"),
    list: document.getElementById("template-list"),
    newButton: document.getElementById("new-template-button"),
    name: document.getElementById("template-name-input"),
    description: document.getElementById("template-description-input"),
    studio: document.getElementById("template-studio"),
    studioToolbar: document.getElementById("studio-toolbar"),
    propertiesPanel: document.querySelector(".properties-panel"),
    modeVisual: document.getElementById("template-mode-visual"),
    modeWikitext: document.getElementById("template-mode-wikitext"),
    sourceActions: document.getElementById("source-mode-actions"),
    sourcePanel: document.getElementById("template-source-panel"),
    sourceInput: document.getElementById("template-source-input"),
    sourceStatus: document.getElementById("template-source-status"),
    sourceApply: document.getElementById("template-source-apply"),
    sourceHelpButton: document.getElementById("template-source-help-button"),
    sourceHelp: document.getElementById("template-source-help"),
    canvas: document.getElementById("drawing-canvas"),
    wikitextPreview: document.getElementById("template-wikitext-preview"),
    undo: document.getElementById("undo-button"),
    redo: document.getElementById("redo-button"),
    imageButton: document.getElementById("add-image-button"),
    imagePlaceholderButton: document.getElementById("add-image-placeholder-button"),
    imageFile: document.getElementById("template-image-file-input"),
    replaceImage: document.getElementById("replace-template-image-button"),
    imageStatus: document.getElementById("template-image-status"),
    textValueInput: document.getElementById("text-value-input"),
    textLinkTools: document.getElementById("template-text-link-tools"),
    textLinkButton: document.getElementById("template-text-link-button"),
    textLinkMenu: document.getElementById("template-text-link-menu"),
    textLinkType: document.getElementById("template-text-link-type"),
    textLinkTargetField: document.getElementById("template-text-link-target-field"),
    textLinkTarget: document.getElementById("template-text-link-target"),
    textLinkSuggestions: document.getElementById("template-text-link-suggestions"),
    textLinkLabel: document.getElementById("template-text-link-label"),
    textLinkNote: document.getElementById("template-text-link-note"),
    textLinkCancel: document.getElementById("template-text-link-cancel"),
    textLinkInsert: document.getElementById("template-text-link-insert"),
    duplicate: document.getElementById("duplicate-button"),
    forward: document.getElementById("bring-forward-button"),
    backward: document.getElementById("send-backward-button"),
    delete: document.getElementById("delete-element-button"),
    summary: document.getElementById("template-summary-input"),
    feedback: document.getElementById("template-feedback"),
    save: document.getElementById("save-template-button"),
    selectionTitle: document.getElementById("selection-title"),
    selectionCopy: document.getElementById("selection-copy"),
    canvasWidth: document.getElementById("canvas-width-input"),
    canvasHeight: document.getElementById("canvas-height-input"),
    canvasBackground: document.getElementById("canvas-background-input"),
    align: document.getElementById("align-drag-input"),
    viewport: document.getElementById("canvas-viewport"),
    stage: document.getElementById("canvas-zoom-stage"),
    zoomOut: document.getElementById("zoom-out-button"),
    zoomIn: document.getElementById("zoom-in-button"),
    zoomFit: document.getElementById("zoom-fit-button"),
    zoomLabel: document.getElementById("zoom-label"),
    elementProperties: document.getElementById("element-properties"),
    textProperties: document.getElementById("text-properties"),
    shapeProperties: document.getElementById("shape-properties"),
    lineProperties: document.getElementById("line-properties"),
    imageProperties: document.getElementById("image-properties"),
    imagePlaceholderProperties: document.getElementById("image-placeholder-properties"),
    commonProperties: document.getElementById("common-properties"),
    textValueField: document.getElementById("text-value-field"),
    placeholderKeyField: document.getElementById("placeholder-key-field"),
    placeholderDefaultField: document.getElementById("placeholder-default-field"),
    shapeKindField: document.getElementById("shape-kind-field"),
    front: document.getElementById("front-button"),
    back: document.getElementById("back-button"),
    newDialog: document.getElementById("new-template-dialog"),
    newForm: document.getElementById("new-template-form"),
    newName: document.getElementById("new-template-name"),
    newDescription: document.getElementById("new-template-description"),
    newWidth: document.getElementById("new-template-width"),
    newHeight: document.getElementById("new-template-height"),
    newFeedback: document.getElementById("new-template-feedback"),
    cancelNew: document.getElementById("cancel-new-template"),
  };

  const state = {
    testing: isTestingEnvironment(), account: null, idToken: "", remoteEndpoint: "",
    templates: [], current: null, draft: null, selectedId: "", selectedIds: [], undo: [], redo: [],
    interaction: null, guides: { x: [], y: [] }, zoom: 1, gestureStartZoom: 1, mode: "visual",
    googleInitialized: false, objectUrls: new Map(),
    imageUploadMode: "add", textLinkSelection: null, linkTargets: { pages: [], categories: [] }, linkSuggestionIndex: -1,
  };

  function isTestingEnvironment() {
    const hostname = String(location.hostname || "").toLowerCase();
    const context = `${navigator.userAgent || ""} ${document.referrer || ""}`.toLowerCase();
    return location.protocol === "file:" || ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
      context.includes("cursor") || context.includes("vscode") || context.includes("electron");
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function randomId(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`; }
  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }
  function slugify(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  }
  function setFeedback(element, message, isError = false) {
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(isError));
  }
  function setDialog(dialog, open) { dialog.hidden = !open; }
  function maxZ() { return Math.max(0, ...(state.draft?.definition?.elements || []).map((item) => Number(item.zIndex) || 0)); }
  function selectedElements() {
    const selected = new Set(state.selectedIds);
    return state.draft?.definition?.elements?.filter((item) => selected.has(item.id)) || [];
  }
  function selectedElement() {
    return state.selectedIds.length === 1
      ? state.draft?.definition?.elements?.find((item) => item.id === state.selectedId) || null
      : null;
  }
  function isSelected(id) { return state.selectedIds.includes(id); }
  function setSelection(ids, primary = ids.at(-1) || "") {
    state.selectedIds = [...new Set(ids)].filter((id) => state.draft?.definition?.elements?.some((item) => item.id === id));
    state.selectedId = state.selectedIds.includes(primary) ? primary : state.selectedIds.at(-1) || "";
  }
  function clearSelection() { setSelection([]); state.guides = { x: [], y: [] }; }
  function whole(value) { return Math.round(Number(value)); }

  function templateTextHref(target) {
    const raw = String(target || "").trim();
    if (!raw) return "#";
    if (raw.toLowerCase() === "cf-edit-current") return "#";
    const [title = "", ...fragmentParts] = raw.replace(/^:/, "").split("#");
    const categoryMatch = String(title).match(/^category\s*:\s*(.+)$/i);
    if (categoryMatch) {
      const wanted = categoryMatch[1].trim();
      const known = state.linkTargets.categories.find((category) =>
        category.name.toLowerCase() === wanted.toLowerCase() || category.slug.toLowerCase() === wanted.toLowerCase()
      );
      const slug = known?.slug || slugify(wanted);
      return slug ? `wiki.html?category=${encodeURIComponent(slug)}` : "wiki.html";
    }
    const wanted = String(title || "").trim();
    const known = state.linkTargets.pages.find((page) =>
      page.title.toLowerCase() === wanted.toLowerCase() || page.slug.toLowerCase() === wanted.toLowerCase()
    );
    const slug = known?.slug || slugify(wanted);
    let href = slug ? `wiki.html?page=${encodeURIComponent(slug)}` : "wiki.html";
    if (fragmentParts.length) {
      const fragment = slugify(fragmentParts.join("#"));
      if (fragment) href += `#${encodeURIComponent(fragment)}`;
    }
    return href;
  }

  function appendVisualTemplateText(node, source) {
    const text = String(source || "");
    const pattern = /\[\[([^\[\]\n]+?)\]\]|\[(https:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) node.append(document.createTextNode(text.slice(cursor, match.index)));
      const anchor = document.createElement("a");
      if (match[1] !== undefined) {
        const parts = String(match[1] || "").split("|");
        const target = String(parts.shift() || "").trim();
        const label = parts.length ? parts.join("|") : target;
        anchor.href = templateTextHref(target);
        anchor.textContent = label;
        anchor.title = target.toLowerCase() === "cf-edit-current" ? "Edit the current wiki page" : target;
      } else {
        anchor.href = match[2];
        anchor.textContent = match[3] || match[2];
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
      anchor.tabIndex = -1;
      node.append(anchor);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) node.append(document.createTextNode(text.slice(cursor)));
  }

  function cleanLinkText(value, { target = false } = {}) {
    let cleaned = String(value || "").replace(/[\[\]|]/g, " ").replace(/\s+/g, " ").trim();
    if (target) cleaned = cleaned.slice(0, 240);
    return cleaned.slice(0, 300);
  }

  function seedDefinition(width = 720, height = 420) {
    return { version: 1, canvas: { width, height, backgroundColor: "#111111" }, elements: [] };
  }

  function seedTemplate() {
    const definition = {
      version: 1, canvas: { width: 420, height: 560, backgroundColor: "#0b0b0b" }, elements: [
        { id: "frame", type: "frame", x: 8, y: 8, width: 404, height: 544, rotation: 0, zIndex: 1, fill: "#111111", stroke: "#df2531", strokeWidth: 3, borderRadius: 22, opacity: 1 },
        { id: "header", type: "shape", shape: "rectangle", x: 8, y: 8, width: 404, height: 88, rotation: 0, zIndex: 2, fill: "#8f1922", stroke: "#df2531", strokeWidth: 0, borderRadius: 20, opacity: 1 },
        { id: "machine-name", type: "placeholder", placeholderKey: "machine_name", defaultValue: "Machine Name", x: 30, y: 29, width: 360, height: 48, rotation: 0, zIndex: 3, fontFamily: "Play", fontSize: 30, fontWeight: 700, fontStyle: "normal", textAlign: "left", color: "#ffffff", opacity: 1 },
        { id: "tier-label", type: "text", text: "TIER", x: 30, y: 126, width: 120, height: 24, rotation: 0, zIndex: 3, fontFamily: "Play", fontSize: 13, fontWeight: 700, fontStyle: "normal", textAlign: "left", color: "#ff9ba2", opacity: 1 },
        { id: "tier-value", type: "placeholder", placeholderKey: "tier", defaultValue: "Tier 1", x: 30, y: 154, width: 360, height: 35, rotation: 0, zIndex: 3, fontFamily: "Play", fontSize: 22, fontWeight: 400, fontStyle: "normal", textAlign: "left", color: "#ffffff", opacity: 1 },
        { id: "category-label", type: "text", text: "CATEGORY", x: 30, y: 214, width: 160, height: 24, rotation: 0, zIndex: 3, fontFamily: "Play", fontSize: 13, fontWeight: 700, fontStyle: "normal", textAlign: "left", color: "#ff9ba2", opacity: 1 },
        { id: "category-value", type: "placeholder", placeholderKey: "category", defaultValue: "Processing", x: 30, y: 242, width: 360, height: 35, rotation: 0, zIndex: 3, fontFamily: "Play", fontSize: 22, fontWeight: 400, fontStyle: "normal", textAlign: "left", color: "#ffffff", opacity: 1 },
        { id: "description-label", type: "text", text: "DESCRIPTION", x: 30, y: 310, width: 180, height: 24, rotation: 0, zIndex: 3, fontFamily: "Play", fontSize: 13, fontWeight: 700, fontStyle: "normal", textAlign: "left", color: "#ff9ba2", opacity: 1 },
        { id: "description-value", type: "placeholder", placeholderKey: "description", defaultValue: "Describe what this machine does.", x: 30, y: 342, width: 360, height: 150, rotation: 0, zIndex: 3, fontFamily: "Play", fontSize: 18, fontWeight: 400, fontStyle: "normal", textAlign: "left", color: "#e6e6e6", opacity: 1 },
      ],
    };
    return {
      id: "template-machine-infobox", slug: "machine-infobox", name: "Machine Infobox",
      description: "A reusable information card for Carbon Frontier machines.",
      canvas: { width: 420, height: 560 }, isDeleted: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      currentRevision: { id: "template-machine-infobox-revision-1", number: 1, definition, editSummary: "Starter template", authorName: "Carbon Frontier", authorRole: "owner", createdAt: new Date().toISOString() },
      placeholders: placeholdersFrom(definition), permissions: { canEdit: true, canDelete: true }, localRevisions: [],
    };
  }

  function placeholdersFrom(definition) {
    if (definition?.kind === "wikitext") {
      const placeholders = Array.isArray(definition.placeholders)
        ? definition.placeholders
        : templateWikitext?.extractPlaceholders?.(definition.source || "") || [];
      return clone(placeholders);
    }
    const result = [], seen = new Set();
    (definition?.elements || []).forEach((element) => {
      if (!["placeholder", "image-placeholder"].includes(element.type) || !element.placeholderKey || seen.has(element.placeholderKey)) return;
      seen.add(element.placeholderKey);
      result.push({
        key: element.placeholderKey,
        label: element.placeholderKey.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        kind: element.type === "image-placeholder" ? "image" : "text",
        defaultValue: element.type === "placeholder" ? element.defaultValue || "" : "",
        defaultAlt: element.type === "image-placeholder" ? element.defaultAlt || "" : "",
      });
    });
    return result;
  }

  function readLocalTemplates() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_TEMPLATES_KEY) || "null");
      const fromLive = window.CarbonFrontierTestingSync?.getSection("wiki")?.templates;
      const base = Array.isArray(fromLive) && fromLive.length ? fromLive : [seedTemplate()];
      if (!Array.isArray(saved)) return clone(base);
      const overrides = new Map(saved.map((item) => [item.id, item]));
      const merged = base.map((item) => overrides.get(item.id) || item);
      saved.forEach((item) => { if (!merged.some((current) => current.id === item.id)) merged.push(item); });
      return clone(merged.filter((item) => !item.isDeleted));
    } catch (error) { return [seedTemplate()]; }
  }

  function saveLocalTemplates() { localStorage.setItem(LOCAL_TEMPLATES_KEY, JSON.stringify(state.templates)); }

  function endpointFor(base, id = "") {
    if (!id) return base;
    return base.startsWith("/api/") ? `${base}/${encodeURIComponent(id)}` : `${base}?id=${encodeURIComponent(id)}`;
  }

  async function fetchWithAuth(endpoint, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.idToken) headers.set("authorization", `Bearer ${state.idToken}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
    return fetch(endpoint, { ...options, headers, cache: "no-store" });
  }

  function setLinkTargetData(pages) {
    const cleanPages = (Array.isArray(pages) ? pages : [])
      .filter((page) => page && !page.isDeleted && page.slug && page.title)
      .map((page) => ({ slug: String(page.slug), title: String(page.title), categories: Array.isArray(page.categories) ? page.categories : [] }));
    const categories = new Map();
    cleanPages.forEach((page) => page.categories.forEach((category) => {
      const name = String(category?.name || "").trim();
      const slug = String(category?.slug || slugify(name)).trim();
      if (name && slug && !categories.has(slug)) categories.set(slug, { slug, name });
    }));
    state.linkTargets = { pages: cleanPages, categories: [...categories.values()] };
  }

  async function loadLinkTargets() {
    if (state.testing) {
      const snapshotPages = window.CarbonFrontierTestingSync?.getSection?.("wiki")?.pages;
      setLinkTargetData(snapshotPages || []);
      return state.linkTargets;
    }
    let lastError = null;
    for (const endpoint of PAGE_ENDPOINTS) {
      try {
        const response = await fetchWithAuth(endpoint);
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) continue;
        if (!response.ok) throw new Error(payload?.error || `Wiki page list failed (${response.status}).`);
        setLinkTargetData(payload?.pages || []);
        return state.linkTargets;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) console.warn("Could not load wiki link suggestions", lastError);
    setLinkTargetData([]);
    return state.linkTargets;
  }

  async function templateRequest({ id = "", method = "GET", body = null } = {}) {
    let lastError = new Error("The wiki template service is unavailable.");
    const bases = state.remoteEndpoint ? [state.remoteEndpoint, ...TEMPLATE_ENDPOINTS.filter((item) => item !== state.remoteEndpoint)] : TEMPLATE_ENDPOINTS;
    for (const base of bases) {
      try {
        const response = await fetchWithAuth(endpointFor(base, id), { method, body: body === null ? null : JSON.stringify(body) });
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && base.startsWith("/api/") && !id) { lastError = new Error(payload?.error || "Template Function not found."); continue; }
        if (!response.ok) { const error = new Error(payload?.error || `Template request failed (${response.status}).`); error.status = response.status; error.code = payload?.code; throw error; }
        state.remoteEndpoint = base;
        return payload;
      } catch (error) { lastError = error; if (error?.status && error.status !== 404) throw error; }
    }
    throw lastError;
  }

  async function uploadImage(file) {
    if (state.testing) {
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("The image could not be read.")); reader.readAsDataURL(file);
      });
      return { id: randomId("local-media"), url };
    }
    let lastError = new Error("The wiki image service is unavailable.");
    for (const endpoint of MEDIA_ENDPOINTS) {
      const form = new FormData(); form.append("file", file);
      const response = await fetchWithAuth(endpoint, { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (response.status === 404 && endpoint.startsWith("/api/")) { lastError = new Error("Image Function not found."); continue; }
      if (!response.ok) throw new Error(payload?.error || `Image upload failed (${response.status}).`);
      return payload.media;
    }
    throw lastError;
  }

  async function hydrateImage(image, element) {
    if (element.url) { image.src = element.url; return; }
    if (!element.mediaId || state.testing) return;
    if (state.objectUrls.has(element.mediaId)) { image.src = state.objectUrls.get(element.mediaId); return; }
    for (const base of MEDIA_ENDPOINTS) {
      const endpoint = base.startsWith("/api/") ? `${base}/${encodeURIComponent(element.mediaId)}` : `${base}?id=${encodeURIComponent(element.mediaId)}`;
      const response = await fetchWithAuth(endpoint);
      if (response.status === 404 && base.startsWith("/api/")) continue;
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob()); state.objectUrls.set(element.mediaId, url); image.src = url; return;
    }
  }

  function getGoogleClientId() { return String(document.querySelector('meta[name="google-signin-client_id"]')?.content || "").trim(); }
  function decodeJwtPayload(token) {
    const parts = String(token || "").split("."); if (parts.length < 2) return null;
    try { const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/"); const padded = `${base64}${"=".repeat((4 - base64.length % 4) % 4)}`; return JSON.parse(decodeURIComponent(Array.from(atob(padded)).map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))); } catch (error) { return null; }
  }
  function loadSession() {
    try { const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null"); const payload = decodeJwtPayload(session?.idToken); if (!session?.email || !payload?.email || payload.email_verified === false || (payload.exp && Number(payload.exp) * 1000 <= Date.now() + 15000)) return null; return { email: String(session.email).toLowerCase(), name: String(session.name || ""), idToken: String(session.idToken || "") }; } catch (error) { return null; }
  }
  function saveSession(account) { if (!state.testing && account?.email) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(account)); }

  function showUnavailable(message) {
    ui.loadingView.hidden = true; ui.view.hidden = true; ui.unavailableView.hidden = false;
    ui.unavailableCopy.textContent = message; ui.accountPill.textContent = state.account ? "No template access" : "Sign in required";
    ui.signinSlot.hidden = Boolean(state.account); if (!ui.signinSlot.hidden) waitForGoogle();
  }
  function showView() {
    ui.loadingView.hidden = true; ui.unavailableView.hidden = true; ui.view.hidden = false;
    ui.accountPill.textContent = state.testing ? "Owner access · Local testing" : `${state.account?.name || "Wiki staff"} · Template editor`;
  }
  async function handleGoogleCredential(response) {
    const payload = decodeJwtPayload(response?.credential);
    if (!payload?.email || payload.email_verified === false) { showUnavailable("Google did not return a verified email account."); return; }
    state.account = { email: String(payload.email).toLowerCase(), name: String(payload.name || ""), idToken: String(response.credential || "") };
    state.idToken = state.account.idToken; saveSession(state.account); await verifyAccess();
  }
  function renderGoogleButton() {
    if (state.testing || !window.google?.accounts?.id) return false;
    if (!state.googleInitialized) { window.google.accounts.id.initialize({ client_id: getGoogleClientId(), callback: handleGoogleCredential, auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_prompt: true }); state.googleInitialized = true; }
    ui.signinSlot.replaceChildren(); window.google.accounts.id.renderButton(ui.signinSlot, { theme: "outline", size: "large", shape: "pill", width: 270 }); return true;
  }
  function waitForGoogle(attempt = 0) { if (renderGoogleButton() || attempt >= 40) return; setTimeout(() => waitForGoogle(attempt + 1), 250); }
  async function verifyAccess() {
    let lastError = new Error("The wiki access service is unavailable.");
    for (const endpoint of ACCESS_ENDPOINTS) {
      try {
        const response = await fetchWithAuth(endpoint); const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) { lastError = new Error("Wiki access Function not found."); continue; }
        if (!response.ok) { const error = new Error(payload?.error || `Access check failed (${response.status}).`); error.status = response.status; throw error; }
        if (!payload?.viewer?.isAssignedStaff) { showUnavailable("Only assigned Wiki Editors, Admins, and Owners can open Template Studio."); return false; }
        showView(); await Promise.all([loadTemplates(), loadLinkTargets()]); return true;
      } catch (error) { lastError = error; if (error?.status && error.status !== 404) break; }
    }
    showUnavailable(lastError.message); return false;
  }

  function pushHistory() {
    if (!state.draft) return;
    state.undo.push(clone(state.draft)); if (state.undo.length > 60) state.undo.shift(); state.redo = []; updateUndoButtons();
  }
  function updateUndoButtons() { ui.undo.disabled = !state.undo.length; ui.redo.disabled = !state.redo.length; }
  function restoreHistory(source, target) {
    if (!source.length || !state.draft) return;
    target.push(clone(state.draft)); state.draft = source.pop();
    setSelection(state.selectedIds, state.selectedId); renderAll();
  }

  function normalizeElement(raw, index) {
    const type = ELEMENT_TYPES.has(raw?.type) ? raw.type : "shape";
    const element = {
      id: String(raw?.id || randomId("element")), type,
      x: clamp(raw?.x, -1600, 3200, 30), y: clamp(raw?.y, -1600, 3200, 30),
      width: clamp(raw?.width, 8, 3200, 180), height: clamp(raw?.height, 8, 3200, 80),
      rotation: clamp(raw?.rotation, -360, 360, 0), zIndex: Math.round(clamp(raw?.zIndex, -1000, 1000, index + 1)), opacity: clamp(raw?.opacity, .05, 1, 1),
    };
    if (type === "text" || type === "placeholder") Object.assign(element, {
      fontFamily: FONT_FAMILIES.has(raw?.fontFamily) ? raw.fontFamily : "Play", fontSize: clamp(raw?.fontSize, 8, 144, 24),
      fontWeight: Number(raw?.fontWeight) >= 700 ? 700 : 400, fontStyle: raw?.fontStyle === "italic" ? "italic" : "normal",
      textAlign: ["left", "center", "right"].includes(raw?.textAlign) ? raw.textAlign : "left", color: /^#[\da-f]{6}$/i.test(raw?.color) ? raw.color : "#ffffff",
      ...(type === "text" ? { text: String(raw?.text || "Text") } : { placeholderKey: String(raw?.placeholderKey || `value_${index + 1}`), defaultValue: String(raw?.defaultValue || "Placeholder text") }),
    });
    else if (type === "line") Object.assign(element, { stroke: raw?.stroke || "#ffffff", strokeWidth: clamp(raw?.strokeWidth, 1, 24, 3) });
    else if (type === "image") Object.assign(element, { mediaId: String(raw?.mediaId || ""), url: String(raw?.url || ""), alt: String(raw?.alt || "Template image"), fit: raw?.fit === "contain" ? "contain" : "cover", borderRadius: clamp(raw?.borderRadius, 0, 200, 0) });
    else if (type === "image-placeholder") Object.assign(element, {
      placeholderKey: slugify(raw?.placeholderKey || `image_${index + 1}`).replaceAll("-", "_") || `image_${index + 1}`,
      defaultAlt: String(raw?.defaultAlt || "Template image").slice(0, 240),
      fit: raw?.fit === "contain" ? "contain" : "cover",
      borderRadius: clamp(raw?.borderRadius, 0, 200, 18),
      fill: raw?.fill || "#1b1b1e", stroke: raw?.stroke || "#df2531", strokeWidth: clamp(raw?.strokeWidth, 0, 24, 2),
    });
    else Object.assign(element, { shape: SHAPES.has(raw?.shape) ? raw.shape : "rectangle", fill: raw?.fill || (type === "frame" ? "transparent" : "#df2531"), stroke: raw?.stroke || "#ffffff", strokeWidth: clamp(raw?.strokeWidth, 0, 24, type === "frame" ? 3 : 1), borderRadius: clamp(raw?.borderRadius, 0, 200, type === "frame" ? 16 : 8) });
    return element;
  }

  function normalizedDefinition(definition) {
    if (definition?.kind === "wikitext" && typeof definition.source === "string") {
      try {
        const parsed = templateWikitext.parse(definition.source);
        parsed.canvas = {
          width: Math.round(clamp(definition?.canvas?.width, 240, 1600, 720)),
          height: Math.round(clamp(definition?.canvas?.height, 120, 1600, 420)),
          backgroundColor: /^#[\da-f]{6}$/i.test(definition?.canvas?.backgroundColor) ? definition.canvas.backgroundColor : "#111111",
        };
        return parsed;
      } catch (error) {
        return { version: 2, kind: "wikitext", source: definition.source, canvas: { width: 720, height: 420, backgroundColor: "#111111" }, elements: [], placeholders: [] };
      }
    }
    return {
      version: 1,
      canvas: { width: Math.round(clamp(definition?.canvas?.width, 240, 1600, 720)), height: Math.round(clamp(definition?.canvas?.height, 120, 1600, 420)), backgroundColor: /^#[\da-f]{6}$/i.test(definition?.canvas?.backgroundColor) ? definition.canvas.backgroundColor : "#111111" },
      elements: (Array.isArray(definition?.elements) ? definition.elements : []).slice(0, 100).map(normalizeElement),
    };
  }

  function drawElement(element) {
    const node = document.createElement("div");
    node.className = `drawing-element element-${element.type}${isSelected(element.id) ? " is-selected" : ""}`;
    node.dataset.elementId = element.id; node.style.left = `${element.x}px`; node.style.top = `${element.y}px`;
    node.style.width = `${element.width}px`; node.style.height = element.type === "line" ? "0" : `${element.height}px`;
    node.style.setProperty("--rotation", `${element.rotation}deg`); node.style.setProperty("--opacity", element.opacity); node.style.zIndex = element.zIndex;
    if (element.type === "text" || element.type === "placeholder") {
      if (element.type === "placeholder") node.textContent = element.defaultValue || `{{${element.placeholderKey}}}`;
      else appendVisualTemplateText(node, element.text);
      Object.assign(node.style, { fontFamily: element.fontFamily, fontSize: `${element.fontSize}px`, fontWeight: element.fontWeight, fontStyle: element.fontStyle, textAlign: element.textAlign, color: element.color });
      if (element.type === "placeholder") { node.dataset.placeholder = element.placeholderKey; node.title = `Placeholder: ${element.placeholderKey}`; }
    } else if (element.type === "line") {
      node.style.borderTopColor = element.stroke; node.style.borderTopWidth = `${element.strokeWidth}px`;
    } else if (element.type === "image") {
      const image = document.createElement("img"); image.alt = element.alt; image.style.objectFit = element.fit; image.style.borderRadius = `${element.borderRadius}px`; node.append(image); hydrateImage(image, element);
    } else if (element.type === "image-placeholder") {
      node.style.background = element.fill; node.style.borderColor = element.stroke; node.style.borderWidth = `${element.strokeWidth}px`; node.style.borderRadius = `${element.borderRadius}px`;
      const label = document.createElement("span"); label.textContent = `Image · ${element.placeholderKey}`; node.append(label);
    } else {
      node.dataset.shape = element.type === "frame" ? "rounded" : element.shape;
      node.style.background = element.fill; node.style.borderColor = element.stroke; node.style.borderWidth = `${element.strokeWidth}px`; node.style.borderRadius = element.shape === "rounded" || element.type === "frame" ? `${element.borderRadius}px` : "0";
    }
    if (state.selectedIds.length === 1 && state.selectedId === element.id) ["nw", "ne", "sw", "se"].forEach((handle) => { const dot = document.createElement("span"); dot.className = "resize-handle"; dot.dataset.handle = handle; node.append(dot); });
    return node;
  }

  function renderCanvas() {
    if (!state.draft) { ui.canvas.replaceChildren(); return; }
    const definition = state.draft.definition;
    if (definition.kind === "wikitext") {
      ui.stage.hidden = true;
      ui.wikitextPreview.hidden = false;
      const values = Object.fromEntries(placeholdersFrom(definition).map((placeholder) => [
        placeholder.key,
        placeholder.kind === "image" ? placeholder.defaultAlt || "" : placeholder.defaultValue || "",
      ]));
      try {
        const result = templateWikitext.render(definition.source, values, { templates: state.templates });
        ui.wikitextPreview.innerHTML = result.html;
      } catch (error) {
        ui.wikitextPreview.textContent = error.message || "This template preview could not be rendered.";
      }
      ui.zoomLabel.textContent = "Preview";
      return;
    }
    ui.stage.hidden = false;
    ui.wikitextPreview.hidden = true;
    ui.wikitextPreview.replaceChildren();
    ui.stage.style.width = `${definition.canvas.width * state.zoom}px`; ui.stage.style.height = `${definition.canvas.height * state.zoom}px`;
    ui.canvas.style.width = `${definition.canvas.width}px`; ui.canvas.style.height = `${definition.canvas.height}px`; ui.canvas.style.background = definition.canvas.backgroundColor; ui.canvas.style.transform = `scale(${state.zoom})`;
    const nodes = [...definition.elements].sort((a, b) => a.zIndex - b.zIndex).map(drawElement);
    state.guides.x.forEach((position) => { const guide = document.createElement("span"); guide.className = "alignment-guide is-vertical"; guide.style.left = `${position}px`; nodes.push(guide); });
    state.guides.y.forEach((position) => { const guide = document.createElement("span"); guide.className = "alignment-guide is-horizontal"; guide.style.top = `${position}px`; nodes.push(guide); });
    ui.canvas.replaceChildren(...nodes);
    ui.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function renderList() {
    if (!state.templates.length) { ui.list.innerHTML = '<div class="empty-state">No templates yet. Create the first reusable design.</div>'; return; }
    ui.list.replaceChildren(...state.templates.map((template) => {
      const button = document.createElement("button"); button.type = "button"; button.className = `template-list-button${template.id === state.current?.id ? " is-active" : ""}`; button.dataset.templateId = template.id;
      const strong = document.createElement("strong"); strong.textContent = template.name; const span = document.createElement("span"); span.textContent = `${template.placeholders?.length || 0} placeholders · Revision ${template.currentRevision?.number || 1}`; button.append(strong, span); return button;
    }));
  }

  function setPropertyInput(input, element) {
    const prop = input.dataset.elementProp; if (!prop) return;
    if (input.type === "checkbox") input.checked = Boolean(element[prop]); else input.value = element[prop] ?? "";
  }

  function renderProperties() {
    const element = selectedElement();
    const selectionCount = state.selectedIds.length;
    ui.canvasWidth.value = state.draft?.definition.canvas.width || 720; ui.canvasHeight.value = state.draft?.definition.canvas.height || 420; ui.canvasBackground.value = state.draft?.definition.canvas.backgroundColor || "#111111";
    ui.elementProperties.hidden = !element; ui.commonProperties.hidden = !element;
    ui.textProperties.hidden = !element || !["text", "placeholder"].includes(element.type);
    ui.shapeProperties.hidden = !element || !["shape", "frame"].includes(element.type);
    ui.lineProperties.hidden = !element || element.type !== "line"; ui.imageProperties.hidden = !element || element.type !== "image";
    ui.imagePlaceholderProperties.hidden = !element || element.type !== "image-placeholder";
    ui.textValueField.hidden = element?.type !== "text"; ui.textLinkTools.hidden = element?.type !== "text"; ui.placeholderKeyField.hidden = element?.type !== "placeholder"; ui.placeholderDefaultField.hidden = element?.type !== "placeholder"; ui.shapeKindField.hidden = element?.type === "frame";
    if (element?.type !== "text") { ui.textLinkMenu.hidden = true; state.textLinkSelection = null; }
    ui.selectionTitle.textContent = selectionCount > 1
      ? `${selectionCount} objects selected`
      : element ? (["placeholder", "image-placeholder"].includes(element.type) ? `Placeholder · ${element.placeholderKey}` : element.type.replace(/^./, (letter) => letter.toUpperCase())) : "Canvas";
    ui.selectionCopy.textContent = selectionCount > 1
      ? "Drag any selected object to move the group. Duplicate, layer, or delete them together."
      : element ? "Drag to move, use the blue handles to resize, or change exact values below." : "Select an object to edit it, or change the canvas below.";
    if (element) document.querySelectorAll("[data-element-prop]").forEach((input) => setPropertyInput(input, element));
    [ui.duplicate, ui.forward, ui.backward, ui.delete, ui.front, ui.back].forEach((button) => { button.disabled = selectionCount === 0; });
  }

  function renderAll() {
    if (state.draft) { ui.name.value = state.draft.name; ui.description.value = state.draft.description || ""; }
    renderList(); renderCanvas(); renderProperties(); updateUndoButtons();
  }

  function setSourceStatus(message, isError = false) {
    ui.sourceStatus.textContent = message || "";
    ui.sourceStatus.classList.toggle("is-error", Boolean(isError));
  }

  function renderEditorMode() {
    const sourceMode = state.mode === "wikitext";
    const sourceTemplatePreview = !sourceMode && state.draft?.definition?.kind === "wikitext";
    ui.studio.classList.toggle("is-source-mode", sourceMode);
    ui.studio.classList.toggle("is-source-template-preview", sourceTemplatePreview);
    ui.modeVisual.setAttribute("aria-pressed", String(!sourceMode));
    ui.modeWikitext.setAttribute("aria-pressed", String(sourceMode));
    ui.studioToolbar.hidden = sourceMode || sourceTemplatePreview;
    ui.viewport.hidden = sourceMode;
    ui.propertiesPanel.hidden = sourceMode || sourceTemplatePreview;
    ui.sourcePanel.hidden = !sourceMode;
    ui.sourceActions.hidden = !sourceMode;
    if (!sourceMode) setSourceStatus(sourceTemplatePreview ? "Rendered MediaWiki template preview · Edit the Wikitext to change it." : "Visual canvas mode");
  }

  function parseTemplateSource() {
    if (!templateWikitext?.parse || Number(templateWikitext.apiVersion) < 2) {
      throw new Error("The old Template Source engine is still cached. Reload this page once, then try again.");
    }
    const definition = templateWikitext.parse(ui.sourceInput.value);
    pushHistory();
    state.draft.definition = definition;
    clearSelection();
    return definition;
  }

  function switchTemplateMode(mode) {
    if (!state.draft || !["visual", "wikitext"].includes(mode) || state.mode === mode) return;
    if (mode === "wikitext") {
      if (!templateWikitext?.format) { setFeedback(ui.feedback, "Template Wikitext could not be loaded. Reload this page and try again.", true); return; }
      ui.sourceInput.value = templateWikitext.format(state.draft.definition);
      state.mode = "wikitext";
      setSourceStatus("Edit the MediaWiki source, then apply it to render a preview.");
      renderEditorMode();
      setTimeout(() => ui.sourceInput.focus(), 0);
      return;
    }
    try {
      parseTemplateSource();
      state.mode = "visual";
      renderEditorMode();
      renderAll();
      setFeedback(ui.feedback, state.draft.definition.kind === "wikitext"
        ? "MediaWiki template source applied. The rendered preview is ready."
        : "Template source applied to the visual canvas.");
    } catch (error) {
      setSourceStatus(error.message || "Fix the MediaWiki template source before returning to Visual mode.", true);
      setFeedback(ui.feedback, "The source has an error. Fix it before switching to Visual mode.", true);
    }
  }

  function applyTemplateSource() {
    if (!state.draft || state.mode !== "wikitext") return;
    try {
      parseTemplateSource();
      state.mode = "visual";
      renderEditorMode();
      renderAll();
      setFeedback(ui.feedback, "MediaWiki template source applied. The rendered preview is ready.");
    } catch (error) {
      setSourceStatus(error.message || "The MediaWiki template source could not be applied.", true);
      setFeedback(ui.feedback, "The source has an error and was not applied.", true);
    }
  }

  function openTemplate(template) {
    state.current = clone(template);
    const definition = normalizedDefinition(template.currentRevision?.definition || seedDefinition(template.canvas?.width, template.canvas?.height));
    state.draft = { name: template.name, description: template.description || "", definition };
    clearSelection(); state.undo = []; state.redo = []; state.mode = "visual"; ui.summary.value = ""; ui.sourceHelp.hidden = true; ui.sourceHelpButton.setAttribute("aria-expanded", "false"); setFeedback(ui.feedback, ""); renderEditorMode(); renderAll();
  }

  async function loadTemplates() {
    try {
      if (state.testing) state.templates = readLocalTemplates();
      else state.templates = (await templateRequest()).templates || [];
      renderList();
      if (state.templates.length) openTemplate(state.templates[0]);
    } catch (error) { setFeedback(ui.feedback, error.message || "Templates could not be loaded.", true); }
  }

  function beginFixedImageUpload(mode = "add") {
    if (!state.draft) return;
    if (mode === "replace" && selectedElement()?.type !== "image") return;
    state.imageUploadMode = mode;
    ui.imageFile.value = "";
    ui.imageFile.click();
  }

  async function handleFixedImageFile() {
    const file = ui.imageFile.files?.[0];
    if (!file || !state.draft) return;
    const replacing = state.imageUploadMode === "replace" && selectedElement()?.type === "image";
    ui.imageButton.disabled = true;
    if (ui.replaceImage) ui.replaceImage.disabled = true;
    if (ui.imageStatus) ui.imageStatus.textContent = replacing ? "Replacing image…" : "Uploading fixed template image…";
    try {
      const media = await uploadImage(file);
      pushHistory();
      if (replacing) {
        const element = selectedElement();
        element.mediaId = String(media?.id || "");
        element.url = state.testing ? String(media?.url || "") : "";
        element.alt = String(file.name || media?.title || "Template image").slice(0, 240);
      } else {
        const element = {
          id: randomId("image"), type: "image", x: 48, y: 48, width: 220, height: 180,
          rotation: 0, zIndex: maxZ() + 1, opacity: 1,
          mediaId: String(media?.id || ""), url: state.testing ? String(media?.url || "") : "",
          alt: String(file.name || media?.title || "Template image").slice(0, 240), fit: "contain", borderRadius: 0,
        };
        state.draft.definition.elements.push(element);
        setSelection([element.id]);
      }
      renderAll();
      setFeedback(ui.feedback, replacing ? "Fixed image replaced. Save the template to publish it." : "Fixed image added. It will appear in every use of this template after you save.");
    } catch (error) {
      setFeedback(ui.feedback, error?.message || "The template image could not be uploaded.", true);
      if (ui.imageStatus) ui.imageStatus.textContent = "The image upload failed.";
    } finally {
      ui.imageButton.disabled = false;
      if (ui.replaceImage) ui.replaceImage.disabled = false;
      ui.imageFile.value = "";
    }
  }

  function closeLinkTargetSuggestions() {
    if (!ui.textLinkSuggestions) return;
    ui.textLinkSuggestions.hidden = true;
    ui.textLinkSuggestions.replaceChildren();
    state.linkSuggestionIndex = -1;
  }

  function matchingLinkTargets(query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return [];
    const scored = [];
    state.linkTargets.pages.forEach((page) => {
      const title = page.title.toLowerCase(), slug = page.slug.toLowerCase();
      if (!title.includes(needle) && !slug.includes(needle)) return;
      scored.push({ kind: "Page", label: page.title, target: page.title, score: title.startsWith(needle) ? 0 : 2 });
    });
    state.linkTargets.categories.forEach((category) => {
      const name = category.name.toLowerCase(), slug = category.slug.toLowerCase();
      if (!name.includes(needle) && !slug.includes(needle) && !`category:${name}`.includes(needle)) return;
      scored.push({ kind: "Category", label: category.name, target: `Category:${category.name}`, score: name.startsWith(needle) ? 1 : 3 });
    });
    return scored.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)).slice(0, 10);
  }

  function renderLinkTargetSuggestions() {
    if (!ui.textLinkSuggestions || ui.textLinkType.value !== "wiki") { closeLinkTargetSuggestions(); return; }
    const query = ui.textLinkTarget.value;
    if (!query.trim()) { closeLinkTargetSuggestions(); return; }
    const matches = matchingLinkTargets(query);
    ui.textLinkSuggestions.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "template-link-suggestions-empty";
      empty.textContent = "No matching wiki pages or categories.";
      ui.textLinkSuggestions.append(empty);
      ui.textLinkSuggestions.hidden = false;
      state.linkSuggestionIndex = -1;
      return;
    }
    matches.forEach((match, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "template-link-suggestion";
      button.dataset.linkTarget = match.target;
      button.dataset.linkLabel = match.label;
      button.dataset.linkSuggestionIndex = String(index);
      const strong = document.createElement("strong");
      strong.textContent = match.kind === "Category" ? `Category: ${match.label}` : match.label;
      const kind = document.createElement("span");
      kind.textContent = match.kind;
      button.append(strong, kind);
      ui.textLinkSuggestions.append(button);
    });
    ui.textLinkSuggestions.hidden = false;
    state.linkSuggestionIndex = -1;
  }

  function chooseLinkTarget(button) {
    if (!button) return;
    ui.textLinkTarget.value = button.dataset.linkTarget || "";
    if (!ui.textLinkLabel.value.trim()) ui.textLinkLabel.value = button.dataset.linkLabel || "";
    closeLinkTargetSuggestions();
    ui.textLinkLabel.focus();
  }

  function updateTextLinkTargetField() {
    const type = ui.textLinkType.value;
    ui.textLinkTargetField.hidden = type === "current-edit";
    ui.textLinkTarget.placeholder = type === "external" ? "https://example.com" : "Coal or Category:Machines";
    ui.textLinkNote.textContent = type === "current-edit"
      ? "This opens the editor for whichever wiki article the template is shown on."
      : type === "wiki"
        ? "Start typing a page or category name, then choose a match. The link is inserted at the current text cursor position."
        : "The link is inserted exactly at the current text cursor position.";
    closeLinkTargetSuggestions();
  }

  function openTextLinkMenu() {
    const element = selectedElement();
    if (element?.type !== "text") return;
    const input = ui.textValueInput;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : String(element.text || "").length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    state.textLinkSelection = { elementId: element.id, start, end };
    ui.textLinkType.value = "wiki";
    ui.textLinkTarget.value = "";
    ui.textLinkLabel.value = input.value.slice(start, end);
    ui.textLinkMenu.hidden = false;
    updateTextLinkTargetField();
    setTimeout(() => (ui.textLinkLabel.value ? ui.textLinkTarget : ui.textLinkLabel).focus(), 0);
  }

  function closeTextLinkMenu({ restoreFocus = true } = {}) {
    ui.textLinkMenu.hidden = true;
    closeLinkTargetSuggestions();
    if (restoreFocus && ui.textValueInput) ui.textValueInput.focus();
  }

  function insertTextLink() {
    const selection = state.textLinkSelection;
    const element = selectedElement();
    if (!selection || element?.type !== "text" || selection.elementId !== element.id) return;
    const type = ui.textLinkType.value;
    const rawTarget = ui.textLinkTarget.value.trim();
    let label = cleanLinkText(ui.textLinkLabel.value);
    let markup = "";
    if (type === "current-edit") {
      label ||= "edit this page";
      markup = `[[cf-edit-current|${label}]]`;
    } else if (type === "external") {
      let url;
      try { url = new URL(rawTarget); } catch { setFeedback(ui.feedback, "Enter a complete HTTPS link first.", true); return; }
      if (url.protocol !== "https:") { setFeedback(ui.feedback, "External template links must use HTTPS.", true); return; }
      label ||= url.hostname;
      markup = `[${url.href} ${label}]`;
    } else {
      const target = cleanLinkText(rawTarget, { target: true });
      if (!target) { setFeedback(ui.feedback, "Enter the wiki page this link should open.", true); return; }
      label ||= target;
      markup = `[[${target}|${label}]]`;
    }
    pushHistory();
    const text = String(element.text || "");
    element.text = `${text.slice(0, selection.start)}${markup}${text.slice(selection.end)}`.slice(0, 1000);
    const caret = Math.min(element.text.length, selection.start + markup.length);
    ui.textLinkMenu.hidden = true;
    state.textLinkSelection = null;
    renderAll();
    setTimeout(() => {
      ui.textValueInput.focus();
      ui.textValueInput.setSelectionRange(caret, caret);
    }, 0);
  }

  function addElement(kind) {
    if (!state.draft) return; pushHistory(); const zIndex = maxZ() + 1; let element;
    if (kind === "text") element = { id: randomId("text"), type: "text", x: 40, y: 40, width: 260, height: 55, rotation: 0, zIndex, opacity: 1, text: "Text", fontFamily: "Play", fontSize: 28, fontWeight: 400, fontStyle: "normal", textAlign: "left", color: "#ffffff" };
    else if (kind === "placeholder") element = { id: randomId("placeholder"), type: "placeholder", x: 40, y: 112, width: 300, height: 55, rotation: 0, zIndex, opacity: 1, placeholderKey: `value_${state.draft.definition.elements.filter((item) => item.type === "placeholder").length + 1}`, defaultValue: "Placeholder text", fontFamily: "Play", fontSize: 24, fontWeight: 400, fontStyle: "normal", textAlign: "left", color: "#ffffff" };
    else if (kind === "line") element = { id: randomId("line"), type: "line", x: 40, y: 210, width: 220, height: 8, rotation: 0, zIndex, opacity: 1, stroke: "#ffffff", strokeWidth: 3 };
    else if (kind === "frame") element = { id: randomId("frame"), type: "frame", x: 32, y: 32, width: 320, height: 220, rotation: 0, zIndex, opacity: 1, shape: "rounded", fill: "transparent", stroke: "#df2531", strokeWidth: 3, borderRadius: 18 };
    else if (kind === "image-placeholder") element = { id: randomId("image-placeholder"), type: "image-placeholder", x: 48, y: 48, width: 260, height: 180, rotation: 0, zIndex, opacity: 1, placeholderKey: `image_${state.draft.definition.elements.filter((item) => item.type === "image-placeholder").length + 1}`, defaultAlt: "Template image", fit: "cover", fill: "#1b1b1e", stroke: "#df2531", strokeWidth: 2, borderRadius: 18 };
    else element = { id: randomId("shape"), type: "shape", x: 56, y: 56, width: 190, height: 110, rotation: 0, zIndex, opacity: 1, shape: kind, fill: "#df2531", stroke: "#ffffff", strokeWidth: 1, borderRadius: kind === "rounded" ? 18 : 8 };
    state.draft.definition.elements.push(element); setSelection([element.id]); renderAll();
  }

  function duplicateSelected() {
    const selected = selectedElements(); if (!selected.length) return; pushHistory();
    const copies = selected.map((element, index) => { const copy = clone(element); copy.id = randomId(element.type); copy.x += 16; copy.y += 16; copy.zIndex = maxZ() + index + 1; return copy; });
    state.draft.definition.elements.push(...copies); setSelection(copies.map((item) => item.id)); renderAll();
  }
  function deleteSelected() { const ids = new Set(state.selectedIds); if (!ids.size) return; pushHistory(); state.draft.definition.elements = state.draft.definition.elements.filter((item) => !ids.has(item.id)); clearSelection(); renderAll(); }
  function moveLayer(mode) {
    const selected = selectedElements(); if (!selected.length) return; pushHistory(); const sorted = [...state.draft.definition.elements].sort((a, b) => a.zIndex - b.zIndex);
    if (mode === "front" || mode === "back") {
      const ordered = [...selected].sort((a,b)=>a.zIndex-b.zIndex); const base = mode === "front" ? maxZ()+1 : Math.min(...sorted.map((item)=>item.zIndex))-ordered.length;
      ordered.forEach((element,index)=>{ element.zIndex=base+index; });
    } else {
      const element = state.draft.definition.elements.find((item)=>item.id===state.selectedId); const index = sorted.findIndex((item) => item.id === element?.id);
      if (mode === "forward" && index < sorted.length - 1) { const other = sorted[index + 1]; [element.zIndex, other.zIndex] = [other.zIndex, element.zIndex]; }
      else if (mode === "backward" && index > 0) { const other = sorted[index - 1]; [element.zIndex, other.zIndex] = [other.zIndex, element.zIndex]; }
    }
    renderAll();
  }

  function canvasPoint(event) {
    const rect = ui.canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (state.draft.definition.canvas.width / rect.width), y: (event.clientY - rect.top) * (state.draft.definition.canvas.height / rect.height) };
  }
  function selectionBounds(elements) {
    const left = Math.min(...elements.map((item) => item.x));
    const top = Math.min(...elements.map((item) => item.y));
    const right = Math.max(...elements.map((item) => item.x + item.width));
    const bottom = Math.max(...elements.map((item) => item.y + item.height));
    return { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
  }
  function smartOffset(axis, bounds, selectedIds) {
    if (!ui.align.checked) return { offset: 0, guide: null };
    const canvas = state.draft.definition.canvas;
    const moving = axis === "x" ? [bounds.left, bounds.centerX, bounds.right] : [bounds.top, bounds.centerY, bounds.bottom];
    const targets = axis === "x" ? [0, canvas.width / 2, canvas.width] : [0, canvas.height / 2, canvas.height];
    state.draft.definition.elements.forEach((item) => {
      if (selectedIds.has(item.id)) return;
      if (axis === "x") targets.push(item.x, item.x + item.width / 2, item.x + item.width);
      else targets.push(item.y, item.y + item.height / 2, item.y + item.height);
    });
    let best = { distance: 7, offset: 0, guide: null };
    moving.forEach((point) => targets.forEach((target) => {
      const distance = Math.abs(target - point);
      if (distance < best.distance) best = { distance, offset: target - point, guide: target };
    }));
    return best;
  }
  function startInteraction(event) {
    const target = event.target.closest(".drawing-element");
    if (!target) { clearSelection(); renderProperties(); renderCanvas(); return; }
    const id = target.dataset.elementId;
    const additive = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? event.metaKey : event.shiftKey;
    if (additive) {
      if (isSelected(id)) setSelection(state.selectedIds.filter((item) => item !== id));
      else setSelection([...state.selectedIds, id], id);
    } else if (!isSelected(id)) setSelection([id], id);
    else state.selectedId = id;
    if (!isSelected(id)) { renderAll(); return; }
    const selected = selectedElements();
    event.preventDefault(); pushHistory();
    const point = canvasPoint(event);
    state.interaction = {
      pointerId: event.pointerId,
      targetId: id,
      mode: event.target.dataset.handle ? "resize" : "move",
      handle: event.target.dataset.handle || "",
      start: point,
      originals: selected.map(clone),
    };
    ui.canvas.setPointerCapture?.(event.pointerId); renderAll();
  }
  function moveInteraction(event) {
    if (!state.interaction) return;
    const point = canvasPoint(event);
    let dx = point.x - state.interaction.start.x, dy = point.y - state.interaction.start.y;
    if (state.interaction.mode === "move") {
      const selectedIds = new Set(state.interaction.originals.map((item) => item.id));
      const originalBounds = selectionBounds(state.interaction.originals);
      const proposed = { left: originalBounds.left + dx, right: originalBounds.right + dx, centerX: originalBounds.centerX + dx, top: originalBounds.top + dy, bottom: originalBounds.bottom + dy, centerY: originalBounds.centerY + dy };
      const xSnap = smartOffset("x", proposed, selectedIds), ySnap = smartOffset("y", proposed, selectedIds);
      dx += xSnap.offset; dy += ySnap.offset;
      state.guides = { x: xSnap.guide === null ? [] : [xSnap.guide], y: ySnap.guide === null ? [] : [ySnap.guide] };
      state.interaction.originals.forEach((original) => {
        const element = state.draft.definition.elements.find((item) => item.id === original.id);
        if (element) { element.x = whole(original.x + dx); element.y = whole(original.y + dy); }
      });
    } else {
      const element = state.draft.definition.elements.find((item) => item.id === state.interaction.targetId);
      const original = state.interaction.originals[0];
      if (!element || !original) return;
      const handle = state.interaction.handle; let left = original.x, top = original.y, right = original.x + original.width, bottom = original.y + original.height;
      if (handle.includes("w")) left = Math.min(right - 8, original.x + dx); if (handle.includes("e")) right = Math.max(left + 8, original.x + original.width + dx); if (handle.includes("n")) top = Math.min(bottom - 8, original.y + dy); if (handle.includes("s")) bottom = Math.max(top + 8, original.y + original.height + dy);
      element.x = whole(left); element.y = whole(top); element.width = Math.max(8, whole(right - left)); element.height = Math.max(8, whole(bottom - top));
    }
    renderCanvas(); renderProperties();
  }
  function endInteraction(event) { if (!state.interaction) return; ui.canvas.releasePointerCapture?.(event.pointerId); state.interaction = null; state.guides = { x: [], y: [] }; renderCanvas(); }

  function setZoom(value, anchor = null) {
    const oldZoom = state.zoom;
    const next = Math.min(3, Math.max(.25, Number(value) || 1));
    if (Math.abs(next - oldZoom) < .001) return;
    const rect = ui.viewport.getBoundingClientRect();
    const clientX = anchor?.clientX ?? rect.left + rect.width / 2;
    const clientY = anchor?.clientY ?? rect.top + rect.height / 2;
    const contentX = (ui.viewport.scrollLeft + clientX - rect.left) / oldZoom;
    const contentY = (ui.viewport.scrollTop + clientY - rect.top) / oldZoom;
    state.zoom = next;
    renderCanvas();
    ui.viewport.scrollLeft = contentX * next - (clientX - rect.left);
    ui.viewport.scrollTop = contentY * next - (clientY - rect.top);
  }
  function fitZoom() {
    if (!state.draft) return;
    const canvas = state.draft.definition.canvas;
    setZoom(Math.min(1, (ui.viewport.clientWidth - 92) / canvas.width, (ui.viewport.clientHeight - 92) / canvas.height));
  }

  function clearSelectionFromWorkspace(event) {
    if (event.target !== ui.viewport && event.target !== ui.stage) return;
    clearSelection(); renderCanvas(); renderProperties();
  }

  function zoomFromWheel(event) {
    if (!event.ctrlKey || !state.draft) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.008);
    setZoom(state.zoom * factor, event);
  }

  function beginGesture(event) {
    event.preventDefault(); state.gestureStartZoom = state.zoom;
  }

  function changeGesture(event) {
    event.preventDefault(); setZoom(state.gestureStartZoom * Number(event.scale || 1), event);
  }

  function updateElementProperty(input) {
    const element = selectedElement(); if (!element) return; const prop = input.dataset.elementProp; let value = input.type === "number" || input.type === "range" ? Number(input.value) : input.value;
    if (["x", "y", "width", "height", "rotation", "fontSize", "strokeWidth", "borderRadius", "opacity"].includes(prop)) value = Number(value);
    if (prop === "placeholderKey") value = slugify(value).replaceAll("-", "_") || "value";
    element[prop] = value; renderCanvas(); if (prop === "placeholderKey") renderProperties();
  }

  async function saveCurrent() {
    if (!state.current || !state.draft) return;
    state.draft.name = ui.name.value.trim(); state.draft.description = ui.description.value.trim();
    if (!state.draft.name) { setFeedback(ui.feedback, "Enter a template name.", true); return; }
    const saveInSourceMode = state.mode === "wikitext";
    if (saveInSourceMode) {
      try { parseTemplateSource(); }
      catch (error) {
        setSourceStatus(error.message || "The MediaWiki template source could not be saved.", true);
        setFeedback(ui.feedback, "Fix the MediaWiki source error before saving.", true);
        return;
      }
    }
    ui.save.disabled = true; setFeedback(ui.feedback, "Saving template revision...");
    try {
      let updated;
      if (state.testing) {
        const revision = { id: randomId("local-template-revision"), number: Number(state.current.currentRevision?.number || 0) + 1, definition: clone(state.draft.definition), editSummary: ui.summary.value.trim(), authorName: CURSOR_ACCOUNT.name, authorRole: "owner", createdAt: new Date().toISOString() };
        updated = { ...state.current, name: state.draft.name, description: state.draft.description, canvas: clone(state.draft.definition.canvas), currentRevision: revision, placeholders: placeholdersFrom(state.draft.definition), updatedAt: new Date().toISOString(), localRevisions: [...(state.current.localRevisions || []), state.current.currentRevision].filter(Boolean) };
        state.templates = state.templates.map((item) => item.id === updated.id ? updated : item); saveLocalTemplates();
      } else {
        updated = (await templateRequest({ id: state.current.id, method: "PATCH", body: { baseRevisionId: state.current.currentRevision.id, name: state.draft.name, description: state.draft.description, definition: state.draft.definition, editSummary: ui.summary.value.trim() } })).template;
        state.templates = state.templates.map((item) => item.id === updated.id ? updated : item);
      }
      openTemplate(updated);
      if (saveInSourceMode) switchTemplateMode("wikitext");
      setFeedback(ui.feedback, `Template revision ${updated.currentRevision.number} saved.`);
    } catch (error) { setFeedback(ui.feedback, error.status === 409 ? "Someone changed this template after you opened it. Reload the page before saving." : error.message || "The template could not be saved.", true); }
    finally { ui.save.disabled = false; }
  }

  async function createTemplate(event) {
    event.preventDefault(); const name = ui.newName.value.trim(), width = Math.round(clamp(ui.newWidth.value, 240, 1600, 720)), height = Math.round(clamp(ui.newHeight.value, 120, 1600, 420));
    if (!name) { setFeedback(ui.newFeedback, "Enter a template name.", true); return; }
    setFeedback(ui.newFeedback, "Creating template...");
    try {
      let created;
      if (state.testing) {
        const definition = seedDefinition(width, height); created = { id: randomId("local-template"), slug: slugify(name), name, description: ui.newDescription.value.trim(), canvas: { width, height }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentRevision: { id: randomId("local-template-revision"), number: 1, definition, editSummary: "Create template", authorName: CURSOR_ACCOUNT.name, authorRole: "owner", createdAt: new Date().toISOString() }, placeholders: [], permissions: { canEdit: true, canDelete: true }, localRevisions: [] }; state.templates.unshift(created); saveLocalTemplates();
      } else created = (await templateRequest({ method: "POST", body: { name, slug: slugify(name), description: ui.newDescription.value.trim(), canvasWidth: width, canvasHeight: height, definition: seedDefinition(width, height), editSummary: "Create template" } })).template;
      if (!state.testing) state.templates.unshift(created); setDialog(ui.newDialog, false); ui.newForm.reset(); openTemplate(created); setFeedback(ui.feedback, "Template created. Add objects, then save your design.");
    } catch (error) { setFeedback(ui.newFeedback, error.message || "The template could not be created.", true); }
  }

  function keydown(event) {
    const typing = event.target.matches("input,textarea,select");
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveCurrent(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !typing) { event.preventDefault(); restoreHistory(event.shiftKey ? state.redo : state.undo, event.shiftKey ? state.undo : state.redo); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y" && !typing) { event.preventDefault(); restoreHistory(state.redo, state.undo); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !typing) { event.preventDefault(); duplicateSelected(); return; }
    if (typing || !selectedElements().length) return;
    if (["Backspace", "Delete"].includes(event.key)) { event.preventDefault(); deleteSelected(); return; }
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key]) {
      event.preventDefault(); pushHistory(); const multiplier = event.shiftKey ? 10 : 1;
      selectedElements().forEach((element) => {
        element.x += directions[event.key][0] * multiplier;
        element.y += directions[event.key][1] * multiplier;
      });
      renderAll();
    }
  }

  document.querySelectorAll("[data-add-element]").forEach((button) => button.addEventListener("click", () => addElement(button.dataset.addElement)));
  document.querySelectorAll("[data-element-prop]").forEach((input) => { input.addEventListener("focus", pushHistory); input.addEventListener("input", () => updateElementProperty(input)); });
  ui.canvasWidth.addEventListener("focus", pushHistory); ui.canvasHeight.addEventListener("focus", pushHistory); ui.canvasBackground.addEventListener("focus", pushHistory);
  ui.canvasWidth.addEventListener("change", () => { state.draft.definition.canvas.width = Math.round(clamp(ui.canvasWidth.value, 240, 1600, 720)); renderAll(); });
  ui.canvasHeight.addEventListener("change", () => { state.draft.definition.canvas.height = Math.round(clamp(ui.canvasHeight.value, 120, 1600, 420)); renderAll(); });
  ui.canvasBackground.addEventListener("input", () => { state.draft.definition.canvas.backgroundColor = ui.canvasBackground.value; renderCanvas(); });
  ui.list.addEventListener("click", (event) => { const button = event.target.closest("[data-template-id]"); if (!button) return; const template = state.templates.find((item) => item.id === button.dataset.templateId); if (template) openTemplate(template); });
  ui.canvas.addEventListener("pointerdown", startInteraction); ui.canvas.addEventListener("pointermove", moveInteraction); ui.canvas.addEventListener("pointerup", endInteraction); ui.canvas.addEventListener("pointercancel", endInteraction);
  ui.viewport.addEventListener("pointerdown", clearSelectionFromWorkspace);
  ui.viewport.addEventListener("wheel", zoomFromWheel, { passive: false });
  ui.viewport.addEventListener("gesturestart", beginGesture, { passive: false });
  ui.viewport.addEventListener("gesturechange", changeGesture, { passive: false });
  ui.undo.addEventListener("click", () => restoreHistory(state.undo, state.redo)); ui.redo.addEventListener("click", () => restoreHistory(state.redo, state.undo));
  ui.duplicate.addEventListener("click", duplicateSelected); ui.delete.addEventListener("click", deleteSelected); ui.forward.addEventListener("click", () => moveLayer("forward")); ui.backward.addEventListener("click", () => moveLayer("backward")); ui.front.addEventListener("click", () => moveLayer("front")); ui.back.addEventListener("click", () => moveLayer("back"));
  ui.imageButton.addEventListener("click", () => beginFixedImageUpload("add"));
  ui.imagePlaceholderButton.addEventListener("click", () => addElement("image-placeholder"));
  ui.imageFile.addEventListener("change", handleFixedImageFile);
  ui.replaceImage.addEventListener("click", () => beginFixedImageUpload("replace"));
  ui.textLinkButton.addEventListener("click", openTextLinkMenu);
  ui.textLinkType.addEventListener("change", updateTextLinkTargetField);
  ui.textLinkTarget.addEventListener("input", renderLinkTargetSuggestions);
  ui.textLinkTarget.addEventListener("keydown", (event) => {
    if (ui.textLinkSuggestions?.hidden) return;
    const buttons = [...ui.textLinkSuggestions.querySelectorAll(".template-link-suggestion")];
    if (!buttons.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.linkSuggestionIndex = (state.linkSuggestionIndex + delta + buttons.length) % buttons.length;
      buttons.forEach((button, index) => button.classList.toggle("is-active", index === state.linkSuggestionIndex));
      buttons[state.linkSuggestionIndex].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && state.linkSuggestionIndex >= 0) {
      event.preventDefault();
      chooseLinkTarget(buttons[state.linkSuggestionIndex]);
    } else if (event.key === "Escape") {
      closeLinkTargetSuggestions();
    }
  });
  ui.textLinkSuggestions?.addEventListener("mousedown", (event) => event.preventDefault());
  ui.textLinkSuggestions?.addEventListener("click", (event) => chooseLinkTarget(event.target.closest(".template-link-suggestion")));
  ui.textLinkCancel.addEventListener("click", () => closeTextLinkMenu());
  ui.textLinkInsert.addEventListener("click", insertTextLink);
  ui.zoomOut.addEventListener("click", () => setZoom(state.zoom / 1.2));
  ui.zoomIn.addEventListener("click", () => setZoom(state.zoom * 1.2));
  ui.zoomFit.addEventListener("click", fitZoom);
  ui.modeVisual.addEventListener("click", () => switchTemplateMode("visual"));
  ui.modeWikitext.addEventListener("click", () => switchTemplateMode("wikitext"));
  ui.sourceApply.addEventListener("click", applyTemplateSource);
  ui.sourceHelpButton.addEventListener("click", () => { const show = ui.sourceHelp.hidden; ui.sourceHelp.hidden = !show; ui.sourceHelpButton.setAttribute("aria-expanded", String(show)); });
  ui.sourceInput.addEventListener("input", () => setSourceStatus("Unsaved source changes · Apply to preview or save the template."));
  ui.save.addEventListener("click", saveCurrent); ui.newButton.addEventListener("click", () => { ui.newForm.reset(); ui.newWidth.value = "720"; ui.newHeight.value = "420"; setFeedback(ui.newFeedback, ""); setDialog(ui.newDialog, true); setTimeout(() => ui.newName.focus(), 0); }); ui.cancelNew.addEventListener("click", () => setDialog(ui.newDialog, false)); ui.newDialog.addEventListener("click", (event) => { if (event.target === ui.newDialog) setDialog(ui.newDialog, false); }); ui.newForm.addEventListener("submit", createTemplate); document.addEventListener("keydown", keydown);
  ui.name.addEventListener("input", () => { if (state.draft) state.draft.name = ui.name.value; }); ui.description.addEventListener("input", () => { if (state.draft) state.draft.description = ui.description.value; });

  async function initialize() {
    updateUndoButtons();
    if (state.testing) { state.account = CURSOR_ACCOUNT; showView(); await Promise.all([loadTemplates(), loadLinkTargets()]); return; }
    const session = loadSession(); if (session) { state.account = session; state.idToken = session.idToken; await verifyAccess(); } else showUnavailable("Sign in with an assigned Wiki Editor, Admin, or Owner account to open Template Studio.");
  }
  initialize();
})();
