(function () {
  "use strict";

  const AUTH_STORAGE_KEY = "carbon-frontier-google-session-v1";
  const LOCAL_TEMPLATES_KEY = "carbon-frontier-wiki-local-templates-v1";
  const ACCESS_ENDPOINTS = ["/api/wiki-access", "/.netlify/functions/wiki-access"];
  const TEMPLATE_ENDPOINTS = ["/api/wiki/templates", "/.netlify/functions/wiki-templates"];
  const MEDIA_ENDPOINTS = ["/api/wiki/media", "/.netlify/functions/wiki-media"];
  const CURSOR_ACCOUNT = { email: "jb141598@gmail.com", name: "Cursor Testing Owner", idToken: "" };
  const FONT_FAMILIES = new Set(["Play", "Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"]);
  const ELEMENT_TYPES = new Set(["text", "placeholder", "shape", "frame", "line", "image"]);
  const SHAPES = new Set(["rectangle", "rounded", "ellipse", "triangle", "diamond"]);

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
    canvas: document.getElementById("drawing-canvas"),
    viewport: document.getElementById("canvas-viewport"),
    undo: document.getElementById("undo-button"),
    redo: document.getElementById("redo-button"),
    imageButton: document.getElementById("add-image-button"),
    imageInput: document.getElementById("template-image-input"),
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
    snap: document.getElementById("snap-grid-input"),
    elementProperties: document.getElementById("element-properties"),
    textProperties: document.getElementById("text-properties"),
    shapeProperties: document.getElementById("shape-properties"),
    lineProperties: document.getElementById("line-properties"),
    imageProperties: document.getElementById("image-properties"),
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
    templates: [], current: null, draft: null, selectedId: "", undo: [], redo: [],
    interaction: null, googleInitialized: false, objectUrls: new Map(),
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
  function selectedElement() { return state.draft?.definition?.elements?.find((item) => item.id === state.selectedId) || null; }
  function snap(value) { return ui.snap.checked ? Math.round(Number(value) / 8) * 8 : Math.round(Number(value)); }

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
    const result = [], seen = new Set();
    (definition?.elements || []).forEach((element) => {
      if (element.type !== "placeholder" || !element.placeholderKey || seen.has(element.placeholderKey)) return;
      seen.add(element.placeholderKey);
      result.push({ key: element.placeholderKey, label: element.placeholderKey.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), defaultValue: element.defaultValue || "" });
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
        showView(); await loadTemplates(); return true;
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
    target.push(clone(state.draft)); state.draft = source.pop(); renderAll();
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
    else Object.assign(element, { shape: SHAPES.has(raw?.shape) ? raw.shape : "rectangle", fill: raw?.fill || (type === "frame" ? "transparent" : "#df2531"), stroke: raw?.stroke || "#ffffff", strokeWidth: clamp(raw?.strokeWidth, 0, 24, type === "frame" ? 3 : 1), borderRadius: clamp(raw?.borderRadius, 0, 200, type === "frame" ? 16 : 8) });
    return element;
  }

  function normalizedDefinition(definition) {
    return {
      version: 1,
      canvas: { width: Math.round(clamp(definition?.canvas?.width, 240, 1600, 720)), height: Math.round(clamp(definition?.canvas?.height, 120, 1600, 420)), backgroundColor: /^#[\da-f]{6}$/i.test(definition?.canvas?.backgroundColor) ? definition.canvas.backgroundColor : "#111111" },
      elements: (Array.isArray(definition?.elements) ? definition.elements : []).slice(0, 100).map(normalizeElement),
    };
  }

  function drawElement(element) {
    const node = document.createElement("div");
    node.className = `drawing-element element-${element.type}${state.selectedId === element.id ? " is-selected" : ""}`;
    node.dataset.elementId = element.id; node.style.left = `${element.x}px`; node.style.top = `${element.y}px`;
    node.style.width = `${element.width}px`; node.style.height = element.type === "line" ? "0" : `${element.height}px`;
    node.style.setProperty("--rotation", `${element.rotation}deg`); node.style.setProperty("--opacity", element.opacity); node.style.zIndex = element.zIndex;
    if (element.type === "text" || element.type === "placeholder") {
      node.textContent = element.type === "placeholder" ? element.defaultValue || `{{${element.placeholderKey}}}` : element.text;
      Object.assign(node.style, { fontFamily: element.fontFamily, fontSize: `${element.fontSize}px`, fontWeight: element.fontWeight, fontStyle: element.fontStyle, textAlign: element.textAlign, color: element.color });
      if (element.type === "placeholder") { node.dataset.placeholder = element.placeholderKey; node.title = `Placeholder: ${element.placeholderKey}`; }
    } else if (element.type === "line") {
      node.style.borderTopColor = element.stroke; node.style.borderTopWidth = `${element.strokeWidth}px`;
    } else if (element.type === "image") {
      const image = document.createElement("img"); image.alt = element.alt; image.style.objectFit = element.fit; image.style.borderRadius = `${element.borderRadius}px`; node.append(image); hydrateImage(image, element);
    } else {
      node.dataset.shape = element.type === "frame" ? "rounded" : element.shape;
      node.style.background = element.fill; node.style.borderColor = element.stroke; node.style.borderWidth = `${element.strokeWidth}px`; node.style.borderRadius = element.shape === "rounded" || element.type === "frame" ? `${element.borderRadius}px` : "0";
    }
    if (state.selectedId === element.id) ["nw", "ne", "sw", "se"].forEach((handle) => { const dot = document.createElement("span"); dot.className = "resize-handle"; dot.dataset.handle = handle; node.append(dot); });
    return node;
  }

  function renderCanvas() {
    if (!state.draft) { ui.canvas.replaceChildren(); return; }
    const definition = state.draft.definition;
    ui.canvas.style.width = `${definition.canvas.width}px`; ui.canvas.style.height = `${definition.canvas.height}px`; ui.canvas.style.background = definition.canvas.backgroundColor;
    ui.canvas.replaceChildren(...[...definition.elements].sort((a, b) => a.zIndex - b.zIndex).map(drawElement));
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
    ui.canvasWidth.value = state.draft?.definition.canvas.width || 720; ui.canvasHeight.value = state.draft?.definition.canvas.height || 420; ui.canvasBackground.value = state.draft?.definition.canvas.backgroundColor || "#111111";
    ui.elementProperties.hidden = !element; ui.commonProperties.hidden = !element;
    ui.textProperties.hidden = !element || !["text", "placeholder"].includes(element.type);
    ui.shapeProperties.hidden = !element || !["shape", "frame"].includes(element.type);
    ui.lineProperties.hidden = !element || element.type !== "line"; ui.imageProperties.hidden = !element || element.type !== "image";
    ui.textValueField.hidden = element?.type !== "text"; ui.placeholderKeyField.hidden = element?.type !== "placeholder"; ui.placeholderDefaultField.hidden = element?.type !== "placeholder"; ui.shapeKindField.hidden = element?.type === "frame";
    ui.selectionTitle.textContent = element ? (element.type === "placeholder" ? `Placeholder · ${element.placeholderKey}` : element.type.replace(/^./, (letter) => letter.toUpperCase())) : "Canvas";
    ui.selectionCopy.textContent = element ? "Drag to move, use the blue handles to resize, or change exact values below." : "Select an object to edit it, or change the canvas below.";
    if (element) document.querySelectorAll("[data-element-prop]").forEach((input) => setPropertyInput(input, element));
    [ui.duplicate, ui.forward, ui.backward, ui.delete, ui.front, ui.back].forEach((button) => { button.disabled = !element; });
  }

  function renderAll() {
    if (state.draft) { ui.name.value = state.draft.name; ui.description.value = state.draft.description || ""; }
    renderList(); renderCanvas(); renderProperties(); updateUndoButtons();
  }

  function openTemplate(template) {
    state.current = clone(template);
    const definition = normalizedDefinition(template.currentRevision?.definition || seedDefinition(template.canvas?.width, template.canvas?.height));
    state.draft = { name: template.name, description: template.description || "", definition };
    state.selectedId = ""; state.undo = []; state.redo = []; ui.summary.value = ""; setFeedback(ui.feedback, ""); renderAll();
  }

  async function loadTemplates() {
    try {
      if (state.testing) state.templates = readLocalTemplates();
      else state.templates = (await templateRequest()).templates || [];
      renderList();
      if (state.templates.length) openTemplate(state.templates[0]);
    } catch (error) { setFeedback(ui.feedback, error.message || "Templates could not be loaded.", true); }
  }

  function addElement(kind) {
    if (!state.draft) return; pushHistory(); const zIndex = maxZ() + 1; let element;
    if (kind === "text") element = { id: randomId("text"), type: "text", x: 40, y: 40, width: 260, height: 55, rotation: 0, zIndex, opacity: 1, text: "Text", fontFamily: "Play", fontSize: 28, fontWeight: 400, fontStyle: "normal", textAlign: "left", color: "#ffffff" };
    else if (kind === "placeholder") element = { id: randomId("placeholder"), type: "placeholder", x: 40, y: 112, width: 300, height: 55, rotation: 0, zIndex, opacity: 1, placeholderKey: `value_${state.draft.definition.elements.filter((item) => item.type === "placeholder").length + 1}`, defaultValue: "Placeholder text", fontFamily: "Play", fontSize: 24, fontWeight: 400, fontStyle: "normal", textAlign: "left", color: "#ffffff" };
    else if (kind === "line") element = { id: randomId("line"), type: "line", x: 40, y: 210, width: 220, height: 8, rotation: 0, zIndex, opacity: 1, stroke: "#ffffff", strokeWidth: 3 };
    else if (kind === "frame") element = { id: randomId("frame"), type: "frame", x: 32, y: 32, width: 320, height: 220, rotation: 0, zIndex, opacity: 1, shape: "rounded", fill: "transparent", stroke: "#df2531", strokeWidth: 3, borderRadius: 18 };
    else element = { id: randomId("shape"), type: "shape", x: 56, y: 56, width: 190, height: 110, rotation: 0, zIndex, opacity: 1, shape: kind, fill: "#df2531", stroke: "#ffffff", strokeWidth: 1, borderRadius: kind === "rounded" ? 18 : 8 };
    state.draft.definition.elements.push(element); state.selectedId = element.id; renderAll();
  }

  function duplicateSelected() {
    const element = selectedElement(); if (!element) return; pushHistory(); const copy = clone(element); copy.id = randomId(element.type); copy.x += 16; copy.y += 16; copy.zIndex = maxZ() + 1; state.draft.definition.elements.push(copy); state.selectedId = copy.id; renderAll();
  }
  function deleteSelected() { if (!selectedElement()) return; pushHistory(); state.draft.definition.elements = state.draft.definition.elements.filter((item) => item.id !== state.selectedId); state.selectedId = ""; renderAll(); }
  function moveLayer(mode) {
    const element = selectedElement(); if (!element) return; pushHistory(); const sorted = [...state.draft.definition.elements].sort((a, b) => a.zIndex - b.zIndex); const index = sorted.findIndex((item) => item.id === element.id);
    if (mode === "front") element.zIndex = maxZ() + 1; else if (mode === "back") element.zIndex = Math.min(...sorted.map((item) => item.zIndex)) - 1;
    else if (mode === "forward" && index < sorted.length - 1) { const other = sorted[index + 1]; [element.zIndex, other.zIndex] = [other.zIndex, element.zIndex]; }
    else if (mode === "backward" && index > 0) { const other = sorted[index - 1]; [element.zIndex, other.zIndex] = [other.zIndex, element.zIndex]; }
    renderAll();
  }

  function canvasPoint(event) {
    const rect = ui.canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (state.draft.definition.canvas.width / rect.width), y: (event.clientY - rect.top) * (state.draft.definition.canvas.height / rect.height) };
  }
  function startInteraction(event) {
    const target = event.target.closest(".drawing-element");
    if (!target) { state.selectedId = ""; renderProperties(); renderCanvas(); return; }
    state.selectedId = target.dataset.elementId; const element = selectedElement(); if (!element) return;
    event.preventDefault(); pushHistory(); const point = canvasPoint(event); state.interaction = { pointerId: event.pointerId, mode: event.target.dataset.handle ? "resize" : "move", handle: event.target.dataset.handle || "", start: point, original: clone(element) }; ui.canvas.setPointerCapture?.(event.pointerId); renderAll();
  }
  function moveInteraction(event) {
    if (!state.interaction) return; const element = selectedElement(); if (!element) return; const point = canvasPoint(event); const dx = point.x - state.interaction.start.x, dy = point.y - state.interaction.start.y, original = state.interaction.original;
    if (state.interaction.mode === "move") { element.x = snap(original.x + dx); element.y = snap(original.y + dy); }
    else {
      const handle = state.interaction.handle; let left = original.x, top = original.y, right = original.x + original.width, bottom = original.y + original.height;
      if (handle.includes("w")) left = Math.min(right - 8, original.x + dx); if (handle.includes("e")) right = Math.max(left + 8, original.x + original.width + dx); if (handle.includes("n")) top = Math.min(bottom - 8, original.y + dy); if (handle.includes("s")) bottom = Math.max(top + 8, original.y + original.height + dy);
      element.x = snap(left); element.y = snap(top); element.width = Math.max(8, snap(right - left)); element.height = Math.max(8, snap(bottom - top));
    }
    renderCanvas(); renderProperties();
  }
  function endInteraction(event) { if (!state.interaction) return; ui.canvas.releasePointerCapture?.(event.pointerId); state.interaction = null; }

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
      openTemplate(updated); setFeedback(ui.feedback, `Template revision ${updated.currentRevision.number} saved.`);
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !typing) { event.preventDefault(); restoreHistory(event.shiftKey ? state.redo : state.undo, event.shiftKey ? state.undo : state.redo); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y" && !typing) { event.preventDefault(); restoreHistory(state.redo, state.undo); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !typing) { event.preventDefault(); duplicateSelected(); return; }
    if (typing || !selectedElement()) return;
    if (["Backspace", "Delete"].includes(event.key)) { event.preventDefault(); deleteSelected(); return; }
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key]) { event.preventDefault(); pushHistory(); const element = selectedElement(), multiplier = event.shiftKey ? 10 : 1; element.x += directions[event.key][0] * multiplier; element.y += directions[event.key][1] * multiplier; renderAll(); }
  }

  document.querySelectorAll("[data-add-element]").forEach((button) => button.addEventListener("click", () => addElement(button.dataset.addElement)));
  document.querySelectorAll("[data-element-prop]").forEach((input) => { input.addEventListener("focus", pushHistory); input.addEventListener("input", () => updateElementProperty(input)); });
  ui.canvasWidth.addEventListener("focus", pushHistory); ui.canvasHeight.addEventListener("focus", pushHistory); ui.canvasBackground.addEventListener("focus", pushHistory);
  ui.canvasWidth.addEventListener("change", () => { state.draft.definition.canvas.width = Math.round(clamp(ui.canvasWidth.value, 240, 1600, 720)); renderAll(); });
  ui.canvasHeight.addEventListener("change", () => { state.draft.definition.canvas.height = Math.round(clamp(ui.canvasHeight.value, 120, 1600, 420)); renderAll(); });
  ui.canvasBackground.addEventListener("input", () => { state.draft.definition.canvas.backgroundColor = ui.canvasBackground.value; renderCanvas(); });
  ui.list.addEventListener("click", (event) => { const button = event.target.closest("[data-template-id]"); if (!button) return; const template = state.templates.find((item) => item.id === button.dataset.templateId); if (template) openTemplate(template); });
  ui.canvas.addEventListener("pointerdown", startInteraction); ui.canvas.addEventListener("pointermove", moveInteraction); ui.canvas.addEventListener("pointerup", endInteraction); ui.canvas.addEventListener("pointercancel", endInteraction);
  ui.undo.addEventListener("click", () => restoreHistory(state.undo, state.redo)); ui.redo.addEventListener("click", () => restoreHistory(state.redo, state.undo));
  ui.duplicate.addEventListener("click", duplicateSelected); ui.delete.addEventListener("click", deleteSelected); ui.forward.addEventListener("click", () => moveLayer("forward")); ui.backward.addEventListener("click", () => moveLayer("backward")); ui.front.addEventListener("click", () => moveLayer("front")); ui.back.addEventListener("click", () => moveLayer("back"));
  ui.imageButton.addEventListener("click", () => ui.imageInput.click());
  ui.imageInput.addEventListener("change", async () => { const file = ui.imageInput.files?.[0]; if (!file) return; setFeedback(ui.feedback, "Uploading image..."); try { const media = await uploadImage(file); pushHistory(); const element = { id: randomId("image"), type: "image", x: 48, y: 48, width: 240, height: 160, rotation: 0, zIndex: maxZ() + 1, opacity: 1, mediaId: media.id || "", url: media.url || "", alt: file.name, fit: "cover", borderRadius: 8 }; state.draft.definition.elements.push(element); state.selectedId = element.id; renderAll(); setFeedback(ui.feedback, "Image added. Drag or resize it on the canvas."); } catch (error) { setFeedback(ui.feedback, error.message || "The image could not be added.", true); } finally { ui.imageInput.value = ""; } });
  ui.save.addEventListener("click", saveCurrent); ui.newButton.addEventListener("click", () => { ui.newForm.reset(); ui.newWidth.value = "720"; ui.newHeight.value = "420"; setFeedback(ui.newFeedback, ""); setDialog(ui.newDialog, true); setTimeout(() => ui.newName.focus(), 0); }); ui.cancelNew.addEventListener("click", () => setDialog(ui.newDialog, false)); ui.newDialog.addEventListener("click", (event) => { if (event.target === ui.newDialog) setDialog(ui.newDialog, false); }); ui.newForm.addEventListener("submit", createTemplate); document.addEventListener("keydown", keydown);
  ui.name.addEventListener("input", () => { if (state.draft) state.draft.name = ui.name.value; }); ui.description.addEventListener("input", () => { if (state.draft) state.draft.description = ui.description.value; });

  async function initialize() {
    updateUndoButtons();
    if (state.testing) { state.account = CURSOR_ACCOUNT; showView(); await loadTemplates(); return; }
    const session = loadSession(); if (session) { state.account = session; state.idToken = session.idToken; await verifyAccess(); } else showUnavailable("Sign in with an assigned Wiki Editor, Admin, or Owner account to open Template Studio.");
  }
  initialize();
})();
