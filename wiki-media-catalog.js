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
    "detail-id","detail-feedback","save-detail-button","delete-image-button","merge-image-button",
    "merge-image-dialog","merge-image-form","merge-image-title","close-merge-image",
    "merge-source-description","merge-target-search","merge-target-select",
    "merge-target-description","merge-impact","merge-acknowledge","merge-feedback",
    "cancel-merge-image","confirm-merge-image",
    "delete-confirm-dialog","delete-confirm-form","delete-confirm-title",
    "close-delete-button","cancel-delete-button","confirm-delete-button",
    "delete-impact-summary","delete-usage-list","delete-usage-note",
    "delete-acknowledge","delete-feedback","retry-catalog-button",
  ].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

  const state = {
    testing: isTestingEnvironment(), account: null, idToken: "", access: null, client: null,
    media: [], selectedId: "", offset: 0, total: 0, loading: false, googleInitialized: false,
    deleteSelectedId: "", deleteUsage: null, deleteBusy: false,
    mergeSourceId: "", mergeBusy: false, mergeTargetOptions: [], mergeSearchTimer: 0,
    objectUrls: new Map(), uploadPreviewUrl: "", uploadFileSelection: null,
    uploadAutoTitle: "", uploadDragDepth: 0, searchTimer: 0,
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
    // The delete confirmation sits above the details dialog. Closing either
    // overlay must not unlock page scrolling while the other remains open.
    document.body.style.overflow = [ui.uploadDialog, ui.detailDialog, ui.deleteConfirmDialog, ui.mergeImageDialog]
      .some((dialog) => dialog && !dialog.hidden) ? "hidden" : "";
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
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 9000);
      try {
        const response = await fetchWithAuth(endpoint, { signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) {
          lastError = new Error("Wiki access service not found.");
          continue;
        }
        if (!response.ok) {
          const error = new Error(payload?.error || `Access request failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error?.name === "AbortError"
          ? new Error("Wiki access took too long. Please retry the catalog.") : error;
        if (error?.status >= 400 && error?.status < 500 && error?.status !== 404) throw error;
      } finally {
        window.clearTimeout(timer);
      }
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
  const FILE_SIZE_LIMIT = 4 * 1024 * 1024;
  const DROP_HINT = "Drag and drop an image here, or click to browse. PNG, JPG, WebP, or GIF up to 4 MB.";

  function stopUploadDragState() {
    state.uploadDragDepth = 0;
    ui.uploadForm.classList.remove("is-drag-over");
    ui.uploadPreview.classList.remove("is-drag-over");
  }

  function clearUploadObjectUrl() {
    if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
    state.uploadPreviewUrl = "";
  }

  function renderEmptyUploadPreview(message = DROP_HINT) {
    clearUploadObjectUrl();
    ui.uploadPreview.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "upload-drop-hint";
    hint.textContent = message;
    ui.uploadPreview.append(hint);
    ui.uploadPreview.classList.remove("has-file");
    ui.uploadPreview.setAttribute("aria-label", message);
  }

  function invalidUploadReason(file) {
    if (!file) return "Choose an image first.";
    if (!ALLOWED_TYPES.has(file.type)) return "Choose a PNG, JPG, WebP, or GIF image.";
    if (!file.size || file.size > FILE_SIZE_LIMIT) return "Images must be between 1 byte and 4 MB.";
    return "";
  }

  function clearUploadFile() {
    state.uploadFileSelection = null;
    ui.uploadFile.value = "";
    ui.uploadFile.required = true;
    ui.uploadButton.disabled = true;
  }

  function selectUploadFile(file, { dropped = false } = {}) {
    const error = invalidUploadReason(file);
    if (error) {
      clearUploadFile();
      renderEmptyUploadPreview("Choose a supported image to continue.");
      setFeedback(ui.uploadFeedback, error, true);
      return false;
    }
    if (dropped) {
      // DataTransfer lets a dropped image behave exactly like one chosen
      // through the native input, including HTML form validation.
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        ui.uploadFile.files = transfer.files;
      } catch {
        // Browsers that disallow changing input.files can still upload from
        // our selected File object (the JS upload handler validates it).
      }
    }
    state.uploadFileSelection = file;
    ui.uploadFile.required = !(ui.uploadFile.files?.length || state.uploadFileSelection);
    ui.uploadButton.disabled = false;
    clearUploadObjectUrl();
    state.uploadPreviewUrl = URL.createObjectURL(file);
    const preview = document.createElement("img");
    preview.src = state.uploadPreviewUrl;
    preview.alt = "Preview of " + file.name;
    const caption = document.createElement("div");
    caption.className = "upload-file-caption";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const details = document.createElement("span");
    details.textContent = formatBytes(file.size) + " · Click or drop to replace";
    caption.append(name, details);
    ui.uploadPreview.replaceChildren(preview, caption);
    ui.uploadPreview.classList.add("has-file");
    ui.uploadPreview.setAttribute("aria-label", "Selected " + file.name + ". Click to choose another image.");
    const autoTitle = defaultTitle(file);
    if (!ui.uploadTitle.value.trim() || ui.uploadTitle.value === state.uploadAutoTitle) {
      ui.uploadTitle.value = autoTitle;
    }
    state.uploadAutoTitle = autoTitle;
    if (!ui.uploadAlt.value.trim()) {
      ui.uploadAlt.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    }
    setFeedback(ui.uploadFeedback, "Image selected. Review its title and details, then add it to the catalog.");
    return true;
  }

  function openUpload() {
    clearUploadObjectUrl();
    ui.uploadForm.reset();
    state.uploadAutoTitle = "";
    state.uploadFileSelection = null;
    ui.uploadFile.required = true;
    ui.uploadButton.disabled = true;
    stopUploadDragState();
    renderEmptyUploadPreview();
    setFeedback(ui.uploadFeedback, "");
    setDialog(ui.uploadDialog, true);
    window.setTimeout(() => ui.uploadFile.focus(), 0);
  }

  function closeUpload() {
    clearUploadObjectUrl();
    stopUploadDragState();
    state.uploadFileSelection = null;
    setDialog(ui.uploadDialog, false);
  }

  function previewUpload() {
    const file = ui.uploadFile.files?.[0];
    if (file) selectUploadFile(file);
    else {
      clearUploadFile();
      renderEmptyUploadPreview();
      setFeedback(ui.uploadFeedback, "");
    }
  }

  function hasFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function wireUploadDropzone() {
    // The preview is also an accessible Browse button.
    ui.uploadPreview.addEventListener("click", () => ui.uploadFile.click());
    ui.uploadPreview.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      ui.uploadFile.click();
    });

    // Accept drops anywhere inside the upload form, including the native
    // Choose File control and the large preview area.
    ui.uploadForm.addEventListener("dragenter", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      state.uploadDragDepth += 1;
      ui.uploadForm.classList.add("is-drag-over");
    });
    ui.uploadForm.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      ui.uploadForm.classList.add("is-drag-over");
    });
    ui.uploadForm.addEventListener("dragleave", (event) => {
      if (!hasFiles(event)) return;
      state.uploadDragDepth = Math.max(0, state.uploadDragDepth - 1);
      if (!state.uploadDragDepth) stopUploadDragState();
    });
    ui.uploadForm.addEventListener("drop", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      stopUploadDragState();
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length !== 1) {
        setFeedback(ui.uploadFeedback, "Drop one image at a time. Multiple-file uploads are not supported.", true);
        return;
      }
      selectUploadFile(files[0], { dropped: true });
    });

    // Prevent the browser from navigating away to the dropped image when a
    // drag misses the form while the upload dialog is open.
    document.addEventListener("dragover", (event) => {
      if (!ui.uploadDialog.hidden && hasFiles(event)) event.preventDefault();
    });
    document.addEventListener("drop", (event) => {
      if (ui.uploadDialog.hidden || !hasFiles(event)) return;
      event.preventDefault();
      stopUploadDragState();
      if (!ui.uploadForm.contains(event.target)) {
        setFeedback(ui.uploadFeedback, "Drop the image inside the upload window.", true);
      }
    });
    window.addEventListener("dragend", stopUploadDragState);
  }

  async function upload(event) {
    event.preventDefault();
    const file = state.uploadFileSelection || ui.uploadFile.files?.[0];
    const issue = invalidUploadReason(file);
    if (issue) { setFeedback(ui.uploadFeedback, issue, true); return; }
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
    ui.deleteImageButton.hidden = !media.canDelete || state.testing;
    ui.deleteImageButton.disabled = !media.canDelete || state.testing || Boolean(media.aliases?.length);
    ui.deleteImageButton.title = media.aliases?.length
      ? "This image is the target of earlier merges. Merge it into another image instead of deleting."
      : "Permanently delete this image";
    ui.mergeImageButton.hidden = !media.canMerge || state.testing;
    ui.mergeImageButton.disabled = !media.canMerge || state.testing;
    ui.detailPreview.replaceChildren();
    const image = document.createElement("img"); image.alt = media.altText || ""; image.hidden = true;
    const loading = document.createElement("span"); loading.textContent = "Loading image...";
    ui.detailPreview.append(image, loading);
    setDialog(ui.detailDialog, true);
    await hydrate(ui.detailPreview, media);
  }
  function closeDetails() {
    if (!ui.deleteConfirmDialog.hidden) closeDeleteConfirmation();
    if (!ui.mergeImageDialog.hidden) closeMergeImage();
    state.selectedId = "";
    setDialog(ui.detailDialog, false);
  }
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



  function closeMergeImage() {
    if (state.mergeBusy) return;
    window.clearTimeout(state.mergeSearchTimer);
    state.mergeSourceId = "";
    state.mergeTargetOptions = [];
    ui.mergeAcknowledge.checked = false;
    ui.mergeAcknowledge.disabled = true;
    ui.confirmMergeImage.disabled = true;
    setDialog(ui.mergeImageDialog, false);
  }

  function syncMergeButton() {
    const selected = state.mergeTargetOptions.find(
      (media) => media.id === ui.mergeTargetSelect.value
    );
    if (selected) {
      ui.mergeTargetDescription.textContent =
        "Keep “" + (selected.title || selected.originalName) + "” and its existing image. " +
        "The duplicate will redirect to this image.";
    } else {
      ui.mergeTargetDescription.textContent = "Select a different image to keep.";
    }
    ui.mergeAcknowledge.disabled = !selected;
    if (!selected) ui.mergeAcknowledge.checked = false;
    ui.confirmMergeImage.disabled =
      !selected || !ui.mergeAcknowledge.checked || state.mergeBusy;
  }

  async function loadMergeTargets() {
    const sourceId = state.mergeSourceId;
    const query = ui.mergeTargetSearch.value.trim();
    ui.mergeTargetSelect.replaceChildren();
    setFeedback(ui.mergeFeedback, "Finding destination images...");
    try {
      const data = await state.client.list({ query, sort: "name", limit: 100 });
      if (sourceId !== state.mergeSourceId || ui.mergeImageDialog.hidden) return;
      state.mergeTargetOptions = (data.media || [])
        .filter((item) => item.id !== sourceId);
      for (const item of state.mergeTargetOptions) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.title || item.originalName || item.id;
        ui.mergeTargetSelect.append(option);
      }
      ui.mergeTargetSelect.selectedIndex = -1;
      if (!state.mergeTargetOptions.length) {
        setFeedback(ui.mergeFeedback, "No matching images found. Search for an existing destination.", true);
      } else {
        setFeedback(ui.mergeFeedback, "Select the image to keep from " +
          state.mergeTargetOptions.length + " matching result(s).");
      }
      syncMergeButton();
    } catch (error) {
      if (sourceId !== state.mergeSourceId) return;
      state.mergeTargetOptions = [];
      syncMergeButton();
      setFeedback(ui.mergeFeedback, error.message || "Could not search images.", true);
    }
  }

  async function openMergeImage() {
    const source = selectedMedia();
    if (!source?.canMerge || state.testing) return;
    state.mergeSourceId = source.id;
    state.mergeTargetOptions = [];
    ui.mergeSourceDescription.textContent =
      "Merge duplicate “" + (source.title || source.originalName) +
      "” into a different image. The destination keeps its original filename, " +
      "and old source image IDs and filenames remain valid redirects.";
    ui.mergeImageTitle.textContent = "Merge “" + (source.title || source.originalName) + "”";
    ui.mergeTargetSearch.value = "";
    ui.mergeTargetSelect.replaceChildren();
    ui.mergeAcknowledge.checked = false;
    ui.mergeAcknowledge.disabled = true;
    ui.confirmMergeImage.disabled = true;
    ui.mergeImpact.textContent = "Checking current usages...";
    setDialog(ui.mergeImageDialog, true);
    const usagePromise = state.client.usage(source.id).then((data) => {
      if (state.mergeSourceId !== source.id || ui.mergeImageDialog.hidden) return;
      const u = data.usage || {};
      ui.mergeImpact.textContent =
        "Confirmed references: " + (u.pagePlacements || 0) +
        " image placements on " + (u.pageCount || 0) +
        " current wiki pages, plus " + (u.templateReferences || 0) +
        " template references. Older revisions and dynamic galleries may have more.";
    }).catch(() => {
      if (state.mergeSourceId === source.id)
        ui.mergeImpact.textContent = "Reference count unavailable. Old references will still redirect to the destination.";
    });
    await Promise.all([loadMergeTargets(), usagePromise]);
  }

  async function performMergeImage(event) {
    event.preventDefault();
    if (state.mergeBusy || !ui.mergeAcknowledge.checked) return;
    const source = selectedMedia();
    const target = state.mergeTargetOptions.find(
      (item) => item.id === ui.mergeTargetSelect.value
    );
    if (!source?.canMerge || source.id !== state.mergeSourceId ||
        !target || source.id === target.id) return;
    state.mergeBusy = true;
    ui.confirmMergeImage.disabled = true;
    ui.cancelMergeImage.disabled = true;
    ui.closeMergeImage.disabled = true;
    setFeedback(ui.mergeFeedback, "Merging image references...");
    try {
      const response = await state.client.merge(source.id, {
        targetId: target.id,
        sourceTitle: source.title || source.originalName,
      });
      const oldUrl = state.objectUrls.get(source.id);
      if (oldUrl) { URL.revokeObjectURL(oldUrl); state.objectUrls.delete(source.id); }
      state.mergeBusy = false;
      closeMergeImage();
      closeDetails();
      ui.catalogSearch.value = "";
      await loadCatalog();
      setFeedback(ui.catalogFeedback, response.warning ||
        "Merged “" + response.merge.sourceName + "” into “" +
        response.merge.targetName + "”. Existing page images now display the destination.");
    } catch (error) {
      setFeedback(ui.mergeFeedback,
        (error?.message || "Image merge failed. No changes were made.") +
        (error?.status === 409 ? " Refresh the catalog and try again." : ""), true);
    } finally {
      state.mergeBusy = false;
      ui.confirmMergeImage.disabled =
        !(ui.mergeAcknowledge.checked && ui.mergeTargetSelect.value);
      ui.cancelMergeImage.disabled = false;
      ui.closeMergeImage.disabled = false;
    }
  }

  function renderDeleteUsage(usage) {
    const images = Number(usage.pagePlacements) || 0;
    const pageCount = Number(usage.pageCount) || 0;
    const templates = Number(usage.templateReferences) || 0;
    const templateCount = Number(usage.templateCount) || 0;
    const plural = (n, one, many) => n === 1 ? one : many;
    if (!images && !templates) {
      ui.deleteImpactSummary.textContent = "No direct image references were found in current saved pages or template definitions. This does not guarantee the image is unused.";
    } else {
      ui.deleteImpactSummary.textContent =
        "Deleting this image will invalidate at least " + images + " image " +
        plural(images, "placement", "placements") + " across " + pageCount + " wiki " +
        plural(pageCount, "page", "pages") + ", plus " + templates + " direct " +
        plural(templates, "reference", "references") + " in " + templateCount + " template " +
        plural(templateCount, "definition", "definitions") + ".";
    }
    ui.deleteUsageList.replaceChildren();
    for (const page of usage.pages || []) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = page.slug === "front-page" ? "/wiki" : "/wiki/" + encodeURIComponent(page.slug);
      a.textContent = page.title || page.slug;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.append(a, document.createTextNode(" — " + page.count + " " +
        plural(page.count, "placement", "placements")));
      ui.deleteUsageList.append(li);
    }
    for (const template of usage.templates || []) {
      const li = document.createElement("li");
      li.textContent = "Template: " + (template.title || template.slug) +
        " — " + template.count + " direct " + plural(template.count, "reference", "references");
      ui.deleteUsageList.append(li);
    }
    ui.deleteUsageList.hidden = !ui.deleteUsageList.children.length;
    ui.deleteUsageNote.textContent = "Counts cover direct references in current published pages and active template definitions, not old revisions, pending edits, or all dynamically generated CategoryGallery/DPL images. Deleting may break additional images.";
    state.deleteUsage = usage;
    ui.deleteAcknowledge.disabled = false;
    ui.deleteAcknowledge.checked = false;
    ui.confirmDeleteButton.disabled = true;
  }

  function closeDeleteConfirmation() {
    if (state.deleteBusy) return;
    state.deleteSelectedId = "";
    state.deleteUsage = null;
    ui.deleteAcknowledge.checked = false;
    ui.deleteAcknowledge.disabled = true;
    ui.confirmDeleteButton.disabled = true;
    setDialog(ui.deleteConfirmDialog, false);
  }

  async function openDeleteConfirmation() {
    const media = selectedMedia();
    if (!media?.canDelete || state.testing || state.deleteBusy) return;
    state.deleteSelectedId = media.id;
    state.deleteUsage = null;
    ui.deleteConfirmTitle.textContent = "Delete " + (media.title || media.originalName) + "?";
    ui.deleteImpactSummary.textContent = "Checking current page and template references...";
    ui.deleteUsageList.replaceChildren();
    ui.deleteUsageList.hidden = true;
    ui.deleteAcknowledge.checked = false;
    ui.deleteAcknowledge.disabled = true;
    ui.confirmDeleteButton.disabled = true;
    setFeedback(ui.deleteFeedback, "Checking image usage...");
    setDialog(ui.deleteConfirmDialog, true);
    try {
      const response = await state.client.usage(media.id);
      if (state.deleteSelectedId !== media.id || ui.deleteConfirmDialog.hidden) return;
      if (!response?.usage?.version) throw new Error("The image usage check did not finish.");
      renderDeleteUsage(response.usage);
      setFeedback(ui.deleteFeedback, "Review the affected pages and confirm if you want to continue.");
    } catch (error) {
      if (state.deleteSelectedId !== media.id || ui.deleteConfirmDialog.hidden) return;
      ui.deleteImpactSummary.textContent = "The impact could not be checked. Deletion is disabled until the check succeeds.";
      setFeedback(ui.deleteFeedback, error.message || "Unable to check usage.", true);
    }
  }

  async function confirmDeleteImage(event) {
    event.preventDefault();
    if (state.deleteBusy || !state.deleteUsage?.version || !ui.deleteAcknowledge.checked) return;
    const media = selectedMedia();
    if (!media || media.id !== state.deleteSelectedId || !media.canDelete) return;
    state.deleteBusy = true;
    ui.confirmDeleteButton.disabled = true;
    ui.cancelDeleteButton.disabled = true;
    ui.closeDeleteButton.disabled = true;
    setFeedback(ui.deleteFeedback, "Removing image from the catalog...");
    try {
      const result = await state.client.remove(media.id, {
        title: media.title || media.originalName,
        version: state.deleteUsage.version,
      });
      state.media = state.media.filter((entry) => entry.id !== media.id);
      if (state.objectUrls.has(media.id)) {
        URL.revokeObjectURL(state.objectUrls.get(media.id));
        state.objectUrls.delete(media.id);
      }
      state.deleteBusy = false;
      closeDeleteConfirmation();
      closeDetails();
      await loadCatalog();
      const affected = Number(result.usage?.pagePlacements || 0);
      setFeedback(ui.catalogFeedback, result.warning ||
        "Image deleted. " + affected + " confirmed page " +
        (affected === 1 ? "placement" : "placements") + " may now be missing.");
    } catch (error) {
      if (error?.status === 409 && /renamed/i.test(String(error.message || ""))) {
        state.deleteUsage = null;
        ui.deleteAcknowledge.checked = false;
        ui.deleteAcknowledge.disabled = true;
        ui.deleteImpactSummary.textContent = "This image was renamed. Close this panel, refresh the catalog, and review the new image details before deleting.";
        setFeedback(ui.deleteFeedback, error.message, true);
      } else if (error?.status === 409) {
        ui.deleteAcknowledge.checked = false;
        ui.deleteAcknowledge.disabled = true;
        state.deleteUsage = null;
        setFeedback(ui.deleteFeedback, "Image details or usages changed. Loading a fresh confirmation...", true);
        try {
          const response = await state.client.usage(media.id);
          if (state.deleteSelectedId === media.id && !ui.deleteConfirmDialog.hidden) {
            renderDeleteUsage(response.usage);
            setFeedback(ui.deleteFeedback, "The usage list changed. Review it again before confirming.", true);
          }
        } catch (refreshError) {
          ui.deleteImpactSummary.textContent = "Could not refresh image usage.";
          setFeedback(ui.deleteFeedback, refreshError.message || "Please reopen the image.", true);
        }
      } else {
        setFeedback(ui.deleteFeedback, error.message || "Image deletion failed. Nothing has been removed.", true);
      }
    } finally {
      state.deleteBusy = false;
      ui.cancelDeleteButton.disabled = false;
      ui.closeDeleteButton.disabled = false;
      ui.confirmDeleteButton.disabled = !(state.deleteUsage?.version && ui.deleteAcknowledge.checked);
    }
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

  ui.retryCatalogButton.addEventListener("click", initialize);
  ui.openUploadButton.addEventListener("click", openUpload);
  ui.closeUploadButton.addEventListener("click", closeUpload);
  ui.cancelUploadButton.addEventListener("click", closeUpload);
  ui.uploadFile.addEventListener("change", previewUpload);
  ui.uploadForm.addEventListener("submit", upload);
  wireUploadDropzone();
  ui.catalogGrid.addEventListener("click", (event) => { const card = event.target.closest("[data-media-id]"); if (card) openDetails(card.dataset.mediaId); });
  ui.closeDetailButton.addEventListener("click", closeDetails);
  ui.cancelDetailButton.addEventListener("click", closeDetails);
  ui.detailForm.addEventListener("submit", saveDetails);
  ui.deleteImageButton.addEventListener("click", openDeleteConfirmation);
  ui.mergeImageButton.addEventListener("click", openMergeImage);
  ui.mergeImageForm.addEventListener("submit", performMergeImage);
  ui.mergeTargetSearch.addEventListener("input", () => {
    window.clearTimeout(state.mergeSearchTimer);
    state.mergeSearchTimer = window.setTimeout(loadMergeTargets, 240);
  });
  ui.mergeTargetSelect.addEventListener("change", syncMergeButton);
  ui.mergeAcknowledge.addEventListener("change", syncMergeButton);
  ui.cancelMergeImage.addEventListener("click", closeMergeImage);
  ui.closeMergeImage.addEventListener("click", closeMergeImage);
  ui.deleteConfirmForm.addEventListener("submit", confirmDeleteImage);
  ui.deleteAcknowledge.addEventListener("change", () => {
    ui.confirmDeleteButton.disabled = !state.deleteUsage?.version ||
      !ui.deleteAcknowledge.checked || state.deleteBusy;
  });
  ui.closeDeleteButton.addEventListener("click", closeDeleteConfirmation);
  ui.cancelDeleteButton.addEventListener("click", closeDeleteConfirmation);
  ui.loadMoreButton.addEventListener("click", () => loadCatalog({ append: true }));
  ui.catalogSort.addEventListener("change", () => loadCatalog());
  ui.catalogSearch.addEventListener("input", () => { window.clearTimeout(state.searchTimer); state.searchTimer = window.setTimeout(() => loadCatalog(), 220); });
  // Modal backdrops and Escape do not close or discard the upload,
  // image-details or deletion-confirmation dialogs. Only explicit controls
  // (X, Cancel, Close, Keep Image) and successful actions dismiss them.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && [
      ui.uploadDialog, ui.detailDialog, ui.deleteConfirmDialog,
    ].some((dialog) => dialog && !dialog.hidden)) event.preventDefault();
  });
  window.addEventListener("beforeunload", () => state.objectUrls.forEach((url) => URL.revokeObjectURL(url)));
  window.addEventListener("carbon-frontier-testing-snapshot-updated", () => { if (state.testing && state.client) loadCatalog(); });
  initialize();
})();
