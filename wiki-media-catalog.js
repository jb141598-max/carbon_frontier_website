(function () {
  "use strict";

  const AUTH_STORAGE_KEY = "carbon-frontier-google-session-v1";
  const ACCESS_ENDPOINTS = ["/api/wiki-access", "/.netlify/functions/wiki-access"];
  const CURSOR_ACCOUNT = { email: "jb141598@gmail.com", name: "Cursor Testing Owner", idToken: "" };
  const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  const ui = Object.fromEntries([
    "account-pill","loading-view","unavailable-view","unavailable-copy","google-signin-slot","catalog-view",
    "catalog-search","catalog-sort","catalog-count","catalog-grid","load-more-button","catalog-feedback",
    "open-upload-button","upload-dialog","upload-form","close-upload-button","cancel-upload-button","upload-file",
    "upload-preview","upload-title","upload-description","upload-alt","upload-caption","upload-tags","upload-credit",
    "upload-source","upload-feedback","upload-button","detail-dialog","detail-form","close-detail-button",
    "cancel-detail-button","detail-preview","detail-heading","detail-title","detail-description","detail-alt",
    "detail-caption","detail-tags","detail-credit","detail-source","detail-type","detail-size","detail-date",
    "detail-id","detail-feedback","save-detail-button",
  ].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

  const state = {
    testing: isTestingEnvironment(), account: null, idToken: "", access: null, client: null,
    media: [], selectedId: "", offset: 0, total: 0, loading: false, googleInitialized: false,
    objectUrls: new Map(), uploadPreviewUrl: "", searchTimer: 0,
  };

  function isTestingEnvironment() {
    const hostname = String(location.hostname || "").toLowerCase();
    const context = `${navigator.userAgent || ""} ${document.referrer || ""}`.toLowerCase();
    return location.protocol === "file:" || ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
      context.includes("cursor") || context.includes("vscode") || context.includes("electron");
  }
  function decodeJwtPayload(token) {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = `${base64}${"=".repeat((4 - base64.length % 4) % 4)}`;
      return JSON.parse(decodeURIComponent(Array.from(atob(padded)).map((character) =>
        `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
    } catch { return null; }
  }
  function loadSession() {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
      const payload = decodeJwtPayload(session?.idToken);
      if (!session?.email || !payload?.email || payload.email_verified === false ||
          (payload.exp && Number(payload.exp) * 1000 <= Date.now() + 15000)) return null;
      return { email: String(session.email).toLowerCase(), name: String(session.name || ""), idToken: String(session.idToken || "") };
    } catch { return null; }
  }
  function saveSession(account) {
    if (!state.testing && account?.email) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(account));
  }
  function getGoogleClientId() {
    return String(document.querySelector('meta[name="google-signin-client_id"]')?.content || "").trim();
  }
  function setFeedback(element, message, isError = false) {
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(isError));
  }
  function setDialog(element, open) {
    element.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  }
  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function fileTitle(value) {
    return String(value || "wiki-image").replace(/[\r\n"\\/]+/g, "-").trim().slice(0, 180) || "wiki-image";
  }
  function defaultTitle(file) {
    const extension = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" })[file.type] || "";
    const chosen = fileTitle(file.name);
    return /\.(png|jpe?g|webp|gif)$/i.test(chosen) ? chosen : `${chosen}${extension}`;
  }
  function metadata(prefix) {
    const source = ui[`${prefix}Source`].value.trim();
    if (source && !/^https:\/\//i.test(source)) throw new Error("Source URL must start with https://");
    return {
      title: fileTitle(ui[`${prefix}Title`].value),
      description: ui[`${prefix}Description`].value,
      altText: ui[`${prefix}Alt`].value,
      defaultCaption: ui[`${prefix}Caption`].value,
      tags: ui[`${prefix}Tags`].value,
      credit: ui[`${prefix}Credit`].value,
      sourceUrl: source,
    };
  }
  async function fetchWithAuth(endpoint, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.idToken) headers.set("authorization", `Bearer ${state.idToken}`);
    if (options.body && typeof options.body === "string") headers.set("content-type", "application/json");
    return fetch(endpoint, { ...options, headers, cache: "no-store" });
  }
  async function loadAccess() {
    if (state.testing) {
      return { viewer: { canView: true, canEdit: true, isAssignedStaff: true, role: "owner" } };
    }
    let lastError = new Error("The wiki access service is unavailable.");
    for (const endpoint of ACCESS_ENDPOINTS) {
      try {
        const response = await fetchWithAuth(endpoint);
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) { lastError = new Error("Wiki access service not found."); continue; }
        if (!response.ok) { const error = new Error(payload?.error || `Access request failed (${response.status}).`); error.status = response.status; throw error; }
        return payload;
      } catch (error) { lastError = error; if (error?.status && error.status !== 404) throw error; }
    }
    throw lastError;
  }
  function showUnavailable(message) {
    ui.loadingView.hidden = true;
    ui.catalogView.hidden = true;
    ui.unavailableView.hidden = false;
    ui.unavailableCopy.textContent = message;
    ui.accountPill.textContent = state.account ? "No catalog access" : "Sign in required";
    ui.googleSigninSlot.hidden = Boolean(state.account);
    if (!state.account) waitForGoogle();
  }
  function showCatalog() {
    ui.loadingView.hidden = true;
    ui.unavailableView.hidden = true;
    ui.catalogView.hidden = false;
    ui.accountPill.textContent = state.testing
      ? "Owner access · Local testing"
      : `${state.account?.name || (state.access.viewer.isAssignedStaff ? "Wiki staff" : "Contributor")} · Image catalog`;
  }
  function handleGoogleCredential(response) {
    const payload = decodeJwtPayload(response?.credential);
    if (!payload?.email || payload.email_verified === false) {
      showUnavailable("Google did not return a verified email account.");
      return;
    }
    state.account = { email: String(payload.email).toLowerCase(), name: String(payload.name || ""), idToken: String(response.credential || "") };
    state.idToken = state.account.idToken;
    saveSession(state.account);
    initialize();
  }
  function renderGoogleButton() {
    if (state.testing || !window.google?.accounts?.id) return false;
    if (!state.googleInitialized) {
      window.google.accounts.id.initialize({ client_id: getGoogleClientId(), callback: handleGoogleCredential, auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_prompt: true });
      state.googleInitialized = true;
    }
    ui.googleSigninSlot.innerHTML = "";
    window.google.accounts.id.renderButton(ui.googleSigninSlot, { theme: "outline", size: "large", shape: "pill", text: "signin_with", width: 270 });
    return true;
  }
  function waitForGoogle(attempt = 0) {
    if (renderGoogleButton() || attempt >= 40) return;
    window.setTimeout(() => waitForGoogle(attempt + 1), 250);
  }

  async function hydrate(container, media) {
    const image = container.querySelector("img");
    const placeholder = container.querySelector("span");
    try {
      let url = state.objectUrls.get(media.id);
      if (!url) {
        url = URL.createObjectURL(await state.client.getBlob(media.id));
        state.objectUrls.set(media.id, url);
      }
      image.src = url;
      image.hidden = false;
      placeholder?.remove();
    } catch (error) {
      if (placeholder) placeholder.textContent = "Preview unavailable";
    }
  }
  function createCard(media) {
    const button = document.createElement("button");
    button.className = "image-card";
    button.type = "button";
    button.dataset.mediaId = media.id;
    const preview = document.createElement("div");
    preview.className = "card-image";
    const image = document.createElement("img");
    image.alt = media.altText || "";
    image.hidden = true;
    const loading = document.createElement("span");
    loading.textContent = "Loading preview...";
    preview.append(image, loading);
    const copy = document.createElement("div");
    copy.className = "card-copy";
    const name = document.createElement("strong");
    name.textContent = media.title || media.originalName;
    const description = document.createElement("p");
    description.textContent = media.description || media.defaultCaption || "No description yet.";
    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.innerHTML = `<span>${formatBytes(media.sizeBytes)}</span><span>${formatDate(media.uploadedAt)}</span>`;
    copy.append(name, description, meta);
    if (media.tags?.length) {
      const row = document.createElement("div");
      row.className = "tag-row";
      media.tags.slice(0, 4).forEach((tag) => { const chip = document.createElement("span"); chip.className = "tag"; chip.textContent = tag; row.append(chip); });
      copy.append(row);
    }
    button.append(preview, copy);
    hydrate(preview, media);
    return button;
  }
  function renderCatalog({ append = false } = {}) {
    if (!append) ui.catalogGrid.replaceChildren();
    if (!state.media.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = ui.catalogSearch.value.trim()
        ? "No catalog images match that search."
        : "The image catalog is empty. Import the first image from your files.";
      ui.catalogGrid.append(empty);
    } else {
      const start = append ? state.media.length - state.lastBatchLength : 0;
      state.media.slice(start).forEach((media) => ui.catalogGrid.append(createCard(media)));
    }
    ui.catalogCount.textContent = `${state.total} image${state.total === 1 ? "" : "s"} in this view`;
    ui.loadMoreButton.hidden = state.media.length >= state.total;
  }
  async function loadCatalog({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    ui.loadMoreButton.disabled = true;
    setFeedback(ui.catalogFeedback, "Loading images...");
    try {
      const offset = append ? state.media.length : 0;
      const payload = await state.client.list({ query: ui.catalogSearch.value.trim(), sort: ui.catalogSort.value, offset, limit: 60 });
      state.lastBatchLength = payload.media.length;
      state.media = append ? [...state.media, ...payload.media] : payload.media;
      state.total = payload.pagination?.total ?? state.media.length;
      renderCatalog({ append });
      setFeedback(ui.catalogFeedback, "");
    } catch (error) {
      setFeedback(ui.catalogFeedback, error.message || "The image catalog could not be loaded.", true);
    } finally { state.loading = false; ui.loadMoreButton.disabled = false; }
  }
  function openUpload() {
    ui.uploadForm.reset();
    ui.uploadPreview.textContent = "Choose a PNG, JPG, WebP, or GIF up to 4 MB.";
    setFeedback(ui.uploadFeedback, "");
    setDialog(ui.uploadDialog, true);
    window.setTimeout(() => ui.uploadFile.focus(), 0);
  }
  function closeUpload() {
    if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
    state.uploadPreviewUrl = "";
    setDialog(ui.uploadDialog, false);
  }
  function previewUpload() {
    const file = ui.uploadFile.files?.[0];
    ui.uploadPreview.replaceChildren();
    if (!file) { ui.uploadPreview.textContent = "Choose a PNG, JPG, WebP, or GIF up to 4 MB."; return; }
    if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
    state.uploadPreviewUrl = URL.createObjectURL(file);
    const image = document.createElement("img"); image.src = state.uploadPreviewUrl; image.alt = "Selected image preview"; ui.uploadPreview.append(image);
    ui.uploadTitle.value = defaultTitle(file);
    if (!ui.uploadAlt.value.trim()) ui.uploadAlt.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  }
  async function upload(event) {
    event.preventDefault();
    const file = ui.uploadFile.files?.[0];
    if (!file) { setFeedback(ui.uploadFeedback, "Choose an image first.", true); return; }
    if (!ALLOWED_TYPES.has(file.type)) { setFeedback(ui.uploadFeedback, "Choose a PNG, JPG, WebP, or GIF image.", true); return; }
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) { setFeedback(ui.uploadFeedback, "Images must be between 1 byte and 4 MB.", true); return; }
    ui.uploadButton.disabled = true;
    setFeedback(ui.uploadFeedback, state.testing ? "Adding image to the local catalog..." : "Uploading image to the protected catalog...");
    try {
      const payload = await state.client.upload(file, metadata("upload"));
      closeUpload();
      ui.catalogSearch.value = "";
      ui.catalogSort.value = "newest";
      await loadCatalog();
      await openDetails(payload.media.id);
      setFeedback(ui.detailFeedback, "Image added. It is now available from every page editor.");
    } catch (error) { setFeedback(ui.uploadFeedback, error.message || "The image could not be added.", true); }
    finally { ui.uploadButton.disabled = false; }
  }
  function selectedMedia() { return state.media.find((item) => item.id === state.selectedId) || null; }
  async function openDetails(id) {
    const media = state.media.find((item) => item.id === id);
    if (!media) return;
    state.selectedId = id;
    ui.detailHeading.textContent = media.title || media.originalName;
    ui.detailTitle.value = media.title || media.originalName;
    ui.detailDescription.value = media.description || "";
    ui.detailAlt.value = media.altText || "";
    ui.detailCaption.value = media.defaultCaption || "";
    ui.detailTags.value = (media.tags || []).join(", ");
    ui.detailCredit.value = media.credit || "";
    ui.detailSource.value = media.sourceUrl || "";
    ui.detailType.textContent = media.contentType?.replace("image/", "").toUpperCase() || "Image";
    ui.detailSize.textContent = formatBytes(media.sizeBytes);
    ui.detailDate.textContent = `Uploaded ${formatDate(media.uploadedAt)}`;
    ui.detailId.textContent = `Media ID: ${media.id}`;
    setFeedback(ui.detailFeedback, media.canEditMetadata ? "These defaults are copied when an editor inserts the image." : "You can view these details, but only the uploader or assigned staff can change them.");
    [...ui.detailForm.querySelectorAll("input,textarea")].forEach((field) => { field.disabled = !media.canEditMetadata; });
    ui.saveDetailButton.hidden = !media.canEditMetadata;
    ui.detailPreview.replaceChildren();
    const image = document.createElement("img"); image.alt = media.altText || ""; image.hidden = true;
    const loading = document.createElement("span"); loading.textContent = "Loading image...";
    ui.detailPreview.append(image, loading);
    setDialog(ui.detailDialog, true);
    await hydrate(ui.detailPreview, media);
  }
  function closeDetails() { state.selectedId = ""; setDialog(ui.detailDialog, false); }
  async function saveDetails(event) {
    event.preventDefault();
    const media = selectedMedia();
    if (!media?.canEditMetadata) return;
    ui.saveDetailButton.disabled = true;
    setFeedback(ui.detailFeedback, "Saving image details...");
    try {
      const payload = await state.client.update(media.id, metadata("detail"));
      const index = state.media.findIndex((item) => item.id === media.id);
      state.media[index] = payload.media;
      closeDetails();
      renderCatalog();
      setFeedback(ui.catalogFeedback, `Details saved for “${payload.media.title}”.`);
    } catch (error) { setFeedback(ui.detailFeedback, error.message || "The image details could not be saved.", true); }
    finally { ui.saveDetailButton.disabled = false; }
  }

  async function initialize() {
    ui.loadingView.hidden = false;
    ui.unavailableView.hidden = true;
    ui.catalogView.hidden = true;
    state.account = state.testing ? CURSOR_ACCOUNT : loadSession();
    state.idToken = state.account?.idToken || "";
    try {
      state.access = await loadAccess();
      if (!state.access?.viewer?.canEdit) {
        showUnavailable(state.access?.viewer?.canView
          ? "The catalog is available to people who can currently edit the wiki."
          : "The wiki is private. Sign in with an assigned wiki staff account.");
        return;
      }
      state.client = window.CarbonFrontierWikiMedia.create({ testing: state.testing, fetcher: fetchWithAuth });
      showCatalog();
      await loadCatalog();
    } catch (error) {
      if (error?.status === 401) {
        localStorage.removeItem(AUTH_STORAGE_KEY); state.account = null; state.idToken = "";
        showUnavailable("Your sign-in expired. Sign in again to open the image catalog.");
      } else showUnavailable(error.message || "The image catalog could not be loaded.");
    }
  }

  ui.openUploadButton.addEventListener("click", openUpload);
  ui.closeUploadButton.addEventListener("click", closeUpload);
  ui.cancelUploadButton.addEventListener("click", closeUpload);
  ui.uploadFile.addEventListener("change", previewUpload);
  ui.uploadForm.addEventListener("submit", upload);
  ui.catalogGrid.addEventListener("click", (event) => { const card = event.target.closest("[data-media-id]"); if (card) openDetails(card.dataset.mediaId); });
  ui.closeDetailButton.addEventListener("click", closeDetails);
  ui.cancelDetailButton.addEventListener("click", closeDetails);
  ui.detailForm.addEventListener("submit", saveDetails);
  ui.loadMoreButton.addEventListener("click", () => loadCatalog({ append: true }));
  ui.catalogSort.addEventListener("change", () => loadCatalog());
  ui.catalogSearch.addEventListener("input", () => { window.clearTimeout(state.searchTimer); state.searchTimer = window.setTimeout(() => loadCatalog(), 220); });
  [ui.uploadDialog, ui.detailDialog].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog === ui.uploadDialog ? closeUpload() : closeDetails(); }));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if (!ui.detailDialog.hidden) closeDetails(); else if (!ui.uploadDialog.hidden) closeUpload(); } });
  window.addEventListener("beforeunload", () => state.objectUrls.forEach((url) => URL.revokeObjectURL(url)));
  window.addEventListener("carbon-frontier-testing-snapshot-updated", () => { if (state.testing && state.client) loadCatalog(); });
  initialize();
})();
