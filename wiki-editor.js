(function () {
  "use strict";

  const LOCAL_PAGE_OVERRIDES_KEY = "carbon-frontier-wiki-local-pages-v3";
  const LEGACY_LOCAL_PAGE_OVERRIDES_KEYS = [
    "carbon-frontier-wiki-local-pages-v2",
    "carbon-frontier-wiki-local-pages-v1",
  ];
  const LOCAL_REDIRECTS_KEY = "carbon-frontier-wiki-local-redirects-v1";
  const PAGE_ENDPOINTS = ["/api/wiki/pages", "/.netlify/functions/wiki-pages"];
  const MEDIA_ENDPOINTS = ["/api/wiki/media", "/.netlify/functions/wiki-media"];
  const BLOCK_TYPES = new Set([
    "paragraph",
    "heading2",
    "heading3",
    "bullet-list",
    "numbered-list",
    "callout",
    "image",
  ]);
  const ALLOWED_INLINE_TAGS = new Set([
    "A",
    "B",
    "BR",
    "CODE",
    "EM",
    "I",
    "S",
    "STRONG",
    "U",
  ]);

  const ui = {
    topTools: document.getElementById("wiki-topbar-tools"),
    topSearch: document.getElementById("wiki-top-search"),
    search: document.getElementById("wiki-search-input"),
    searchDialog: document.getElementById("wiki-search-dialog"),
    searchMenuInput: document.getElementById("wiki-search-menu-input"),
    searchResults: document.getElementById("wiki-search-results"),
    closeSearch: document.getElementById("close-search-button"),
    searchActions: document.getElementById("search-menu-actions"),
    newPage: document.getElementById("new-page-button"),
    openTrash: document.getElementById("open-trash-button"),
    articleSurface: document.getElementById("article-surface"),
    breadcrumb: document.getElementById("article-breadcrumb"),
    title: document.getElementById("article-title"),
    titleInput: document.getElementById("editor-title-input"),
    meta: document.getElementById("article-meta"),
    content: document.getElementById("article-content"),
    editPage: document.getElementById("edit-page-button"),
    historyButton: document.getElementById("history-button"),
    feedback: document.getElementById("wiki-feedback"),
    documentToolbar: document.getElementById("document-toolbar"),
    undo: document.getElementById("toolbar-undo"),
    redo: document.getElementById("toolbar-redo"),
    blockStyle: document.getElementById("toolbar-block-style"),
    bold: document.getElementById("toolbar-bold"),
    italic: document.getElementById("toolbar-italic"),
    underline: document.getElementById("toolbar-underline"),
    link: document.getElementById("toolbar-link"),
    bullets: document.getElementById("toolbar-bullets"),
    numbers: document.getElementById("toolbar-numbers"),
    image: document.getElementById("toolbar-image"),
    pageSettings: document.getElementById("toolbar-page-settings"),
    normalEditsField: document.getElementById("toolbar-permission-field"),
    normalEdits: document.getElementById("editor-normal-edits-input"),
    editSummary: document.getElementById("edit-summary-input"),
    savePage: document.getElementById("save-page-button"),
    cancelEditor: document.getElementById("cancel-editor-button"),
    linkPopover: document.getElementById("toolbar-link-popover"),
    linkUrl: document.getElementById("toolbar-link-url"),
    linkApply: document.getElementById("toolbar-link-apply"),
    linkCancel: document.getElementById("toolbar-link-cancel"),
    newDialog: document.getElementById("new-page-dialog"),
    newForm: document.getElementById("new-page-form"),
    newTitle: document.getElementById("new-page-title-input"),
    newSlug: document.getElementById("new-page-slug-input"),
    newIntro: document.getElementById("new-page-intro-input"),
    newFeedback: document.getElementById("new-page-feedback"),
    createPage: document.getElementById("create-page-button"),
    closeNew: document.getElementById("close-new-page-button"),
    cancelNew: document.getElementById("cancel-new-page-button"),
    historyDialog: document.getElementById("history-dialog"),
    historyTitle: document.getElementById("history-dialog-title"),
    closeHistory: document.getElementById("close-history-button"),
    historyList: document.getElementById("history-list"),
    historySelectionLabel: document.getElementById("history-selection-label"),
    historySelectionTitle: document.getElementById("history-selection-title"),
    historySelectionMeta: document.getElementById("history-selection-meta"),
    historyDiffSummary: document.getElementById("history-diff-summary"),
    selectedPreview: document.getElementById("selected-revision-preview"),
    currentPreview: document.getElementById("current-revision-preview"),
    restoreRevision: document.getElementById("restore-revision-button"),
    historyFeedback: document.getElementById("history-feedback"),
    mediaDialog: document.getElementById("media-dialog"),
    mediaForm: document.getElementById("media-form"),
    mediaFile: document.getElementById("media-file-input"),
    mediaAlt: document.getElementById("media-alt-input"),
    mediaCaption: document.getElementById("media-caption-input"),
    mediaPreview: document.getElementById("media-preview"),
    mediaFeedback: document.getElementById("media-feedback"),
    uploadMedia: document.getElementById("upload-media-button"),
    closeMedia: document.getElementById("close-media-button"),
    cancelMedia: document.getElementById("cancel-media-button"),
    managementDialog: document.getElementById("page-management-dialog"),
    managementTitle: document.getElementById("page-management-title"),
    managementNormalEdits: document.getElementById("management-normal-edits-input"),
    moveSlug: document.getElementById("move-page-slug-input"),
    movePage: document.getElementById("move-page-button"),
    trashPage: document.getElementById("trash-page-button"),
    managementFeedback: document.getElementById("page-management-feedback"),
    closeManagement: document.getElementById("close-page-management-button"),
    trashDialog: document.getElementById("trash-dialog"),
    trashList: document.getElementById("trash-list"),
    trashFeedback: document.getElementById("trash-feedback"),
    closeTrash: document.getElementById("close-trash-button"),
  };

  const app = {
    pages: [],
    currentPage: null,
    currentSlug: slugFromLocation(),
    slugManuallyEdited: false,
    editing: false,
    editingBasePage: null,
    savedSelection: null,
    history: [],
    selectedRevision: null,
    restoreArmedRevisionId: "",
    searchIndex: -1,
    pageListPermissions: {},
    trashArmedSlug: "",
    mediaPreviewUrl: "",
  };

  function core() {
    return window.CarbonFrontierWikiCore;
  }

  function coreState() {
    return core()?.getState?.() || {};
  }

  function isTesting() {
    return Boolean(core()?.isTestingEnvironment?.());
  }

  function viewer() {
    return coreState().access?.viewer || null;
  }

  function slugFromLocation() {
    const pageUrl = new URL(window.location.href);
    const querySlug = pageUrl.searchParams.get("page");
    if (querySlug) {
      return normalizeSlug(querySlug) || "front-page";
    }
    const match = window.location.pathname.match(/\/wiki\/([^/]+)(?:\/history)?\/?$/i);
    return match && match[1] !== "permissions"
      ? normalizeSlug(decodeURIComponent(match[1])) || "front-page"
      : "front-page";
  }

  function normalizeSlug(value) {
    return String(value || "").trim().toLowerCase();
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

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function randomId(prefix) {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "unknown time";
    }
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function authorLabel(revision) {
    if (String(revision?.authorName || "").trim()) {
      return revision.authorName.trim();
    }
    if (revision?.authorEmail === "system") {
      return "Carbon Frontier";
    }
    if (["owner", "admin", "wiki_editor"].includes(revision?.authorRole)) {
      return "Assigned wiki editor";
    }
    return "Contributor";
  }

  function setFeedback(element, message, isError = false) {
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function setDialog(dialog, open) {
    dialog.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  }

  function pageEndpoint(base, slug = "", query = {}) {
    const target = new URL(base, window.location.origin);
    if (slug) {
      if (base.startsWith("/api/")) {
        target.pathname = `${target.pathname.replace(/\/$/, "")}/${encodeURIComponent(slug)}`;
      } else {
        target.searchParams.set("slug", slug);
      }
    }
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        target.searchParams.set(key, String(value));
      }
    });
    return `${target.pathname}${target.search}`;
  }

  async function remoteRequest({ slug = "", query = {}, method = "GET", body = null } = {}) {
    let lastError = new Error("The wiki page service is unavailable.");
    for (const base of PAGE_ENDPOINTS) {
      try {
        const options = { method };
        if (body !== null) {
          options.body = JSON.stringify(body);
        }
        const response = await core().fetchWithAuth(pageEndpoint(base, slug, query), options);
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && base.startsWith("/api/")) {
          lastError = Object.assign(
            new Error(payload?.error || "The wiki page service was not found."),
            { status: 404 }
          );
          continue;
        }
        if (!response.ok) {
          const error = new Error(payload?.error || `Wiki request failed (${response.status}).`);
          error.status = response.status;
          error.code = payload?.code || "";
          error.payload = payload;
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status !== 404) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async function uploadMediaFile(file) {
    if (isTesting()) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
        reader.addEventListener("error", () => reject(new Error("The local image could not be read.")), { once: true });
        reader.readAsDataURL(file);
      });
      return {
        ok: true,
        media: {
          id: randomId("local-media"),
          originalName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          url: dataUrl,
        },
      };
    }

    let lastError = new Error("The wiki image service is unavailable.");
    for (const endpoint of MEDIA_ENDPOINTS) {
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await core().fetchWithAuth(endpoint, { method: "POST", body: form });
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) {
          lastError = new Error(payload?.error || "The wiki image service was not found.");
          continue;
        }
        if (!response.ok) {
          const error = new Error(payload?.error || `Image upload failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status !== 404) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async function fetchProtectedMedia(mediaId) {
    let lastError = new Error("The wiki image could not be loaded.");
    for (const base of MEDIA_ENDPOINTS) {
      const endpoint = base.startsWith("/api/")
        ? `${base}/${encodeURIComponent(mediaId)}`
        : `${base}?id=${encodeURIComponent(mediaId)}`;
      try {
        const response = await core().fetchWithAuth(endpoint);
        if (response.status === 404 && base.startsWith("/api/")) {
          continue;
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const error = new Error(payload?.error || `Image request failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        return response.blob();
      } catch (error) {
        lastError = error;
        if (error?.status && error.status !== 404) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  function readLocalOverrides() {
    try {
      const current = localStorage.getItem(LOCAL_PAGE_OVERRIDES_KEY);
      const legacy = LEGACY_LOCAL_PAGE_OVERRIDES_KEYS
        .map((key) => localStorage.getItem(key))
        .find(Boolean);
      const parsed = JSON.parse(current || legacy || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeLocalOverrides(overrides) {
    try {
      localStorage.setItem(LOCAL_PAGE_OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (error) {
      // A locked-down preview can deny storage. This page load still remains usable.
    }
  }

  function readLocalRedirects() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_REDIRECTS_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeLocalRedirects(redirects) {
    try {
      localStorage.setItem(LOCAL_REDIRECTS_KEY, JSON.stringify(redirects));
    } catch (error) {
      // The redirect remains usable for the current save even if preview storage is blocked.
    }
  }

  function testingRedirects() {
    const snapshotRedirects = window.CarbonFrontierTestingSync?.getSection("wiki")?.redirects;
    const combined = {};
    if (Array.isArray(snapshotRedirects)) {
      snapshotRedirects.forEach((redirect) => {
        if (redirect?.sourceSlug && redirect?.targetSlug) {
          combined[redirect.sourceSlug] = redirect.targetSlug;
        }
      });
    }
    return { ...combined, ...readLocalRedirects() };
  }

  function fallbackFrontPage() {
    const createdAt = new Date().toISOString();
    const revision = {
      id: "revision-front-page-1",
      number: 1,
      title: "Carbon Frontier Wiki",
      content: {
        type: "document",
        version: 2,
        blocks: [
          {
            id: "front-page-intro",
            type: "paragraph",
            text: "Welcome to the Carbon Frontier wiki. Use this page to introduce the game and guide readers to its most important articles.",
          },
        ],
      },
      editSummary: "Create the wiki front page",
      authorEmail: "system",
      authorName: "Carbon Frontier",
      authorRole: "owner",
      createdAt,
    };
    return {
      id: "page-front-page",
      slug: "front-page",
      title: "Carbon Frontier Wiki",
      allowNormalEdits: true,
      createdAt,
      updatedAt: createdAt,
      createdBy: "system",
      updatedBy: "system",
      currentRevision: revision,
      localRevisions: [revision],
    };
  }

  function ensureLocalHistory(page) {
    const result = clone(page);
    if (!Array.isArray(result.localRevisions)) {
      result.localRevisions = result.currentRevision ? [clone(result.currentRevision)] : [];
    }
    if (
      result.currentRevision &&
      !result.localRevisions.some((revision) => revision.id === result.currentRevision.id)
    ) {
      result.localRevisions.push(clone(result.currentRevision));
    }
    result.localRevisions = result.localRevisions.map((revision) => ({
      ...revision,
      title: revision.title || result.title,
    }));
    if (result.currentRevision) {
      result.currentRevision.title = result.currentRevision.title || result.title;
    }
    return result;
  }

  function withTestingPermissions(page) {
    return {
      ...ensureLocalHistory(page),
      permissions: {
        canEdit: true,
        canChangePageSettings: true,
        canRestoreRevisions: true,
        canManagePage: true,
      },
    };
  }

  function testingPages({ includeDeleted = false } = {}) {
    const snapshotPages = window.CarbonFrontierTestingSync?.getSection("wiki")?.pages;
    const basePages = Array.isArray(snapshotPages) && snapshotPages.length
      ? snapshotPages.map(clone)
      : [clone(coreState().frontPage || fallbackFrontPage())];
    const merged = new Map(basePages.map((page) => [page.slug, page]));
    Object.values(readLocalOverrides()).forEach((page) => {
      if (page?.slug) {
        merged.set(page.slug, clone(page));
      }
    });
    Object.keys(testingRedirects()).forEach((sourceSlug) => merged.delete(sourceSlug));
    return [...merged.values()]
      .map(withTestingPermissions)
      .filter((page) => includeDeleted || !page.isDeleted);
  }

  function pageSummary(page) {
    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      allowNormalEdits: page.allowNormalEdits,
      isDeleted: Boolean(page.isDeleted),
      deletedAt: page.deletedAt || null,
      updatedAt: page.updatedAt,
      updatedBy: page.updatedBy,
      revisionNumber: page.currentRevision?.number || null,
      editSummary: page.currentRevision?.editSummary || "",
      authorName: page.currentRevision?.authorName || null,
      authorEmail: page.currentRevision?.authorEmail || null,
    };
  }

  async function listPages() {
    if (isTesting()) {
      return {
        ok: true,
        permissions: { canCreate: true, isAssignedStaff: true, canManageTrash: true },
        pages: testingPages().map(pageSummary),
      };
    }
    return remoteRequest();
  }

  async function getPage(slug) {
    if (isTesting()) {
      let page = testingPages().find((candidate) => candidate.slug === slug);
      let redirect = null;
      if (!page) {
        const targetSlug = testingRedirects()[slug];
        page = testingPages().find((candidate) => candidate.slug === targetSlug);
        if (page) {
          redirect = { sourceSlug: slug, targetSlug: page.slug };
        }
      }
      if (!page) {
        const error = new Error("Wiki page not found.");
        error.status = 404;
        throw error;
      }
      return { ok: true, page, redirect };
    }
    return remoteRequest({ slug });
  }

  async function listTrashPages() {
    if (isTesting()) {
      return {
        ok: true,
        permissions: { canManageTrash: true },
        pages: testingPages({ includeDeleted: true }).filter((page) => page.isDeleted),
      };
    }
    return remoteRequest({ query: { trash: 1 } });
  }

  async function getHistory(slug) {
    if (isTesting()) {
      const page = testingPages().find((candidate) => candidate.slug === slug);
      if (!page) {
        throw new Error("Wiki page not found.");
      }
      const revisions = [...page.localRevisions]
        .sort((left, right) => Number(right.number) - Number(left.number))
        .map((revision) => ({
          id: revision.id,
          number: Number(revision.number),
          title: revision.title || page.title,
          editSummary: revision.editSummary || "",
          authorEmail: revision.authorEmail || null,
          authorName: revision.authorName || null,
          authorRole: revision.authorRole || "contributor",
          createdAt: revision.createdAt,
          isCurrent: revision.id === page.currentRevision?.id,
        }));
      return { ok: true, page, revisions };
    }
    return remoteRequest({ slug, query: { history: 1 } });
  }

  async function getRevision(slug, number) {
    if (isTesting()) {
      const page = testingPages().find((candidate) => candidate.slug === slug);
      const revision = page?.localRevisions.find(
        (candidate) => Number(candidate.number) === Number(number)
      );
      if (!revision) {
        throw new Error("Wiki revision not found.");
      }
      return {
        ok: true,
        page,
        revision: {
          ...clone(revision),
          isCurrent: revision.id === page.currentRevision?.id,
        },
      };
    }
    return remoteRequest({ slug, query: { revision: number } });
  }

  async function createPage(body) {
    if (!isTesting()) {
      return remoteRequest({ method: "POST", body });
    }
    if (
      testingPages({ includeDeleted: true }).some((page) => page.slug === body.slug) ||
      Object.hasOwn(testingRedirects(), body.slug)
    ) {
      const error = new Error("A wiki page already uses that address.");
      error.status = 409;
      throw error;
    }
    const now = new Date().toISOString();
    const revision = {
      id: randomId("local-revision"),
      number: 1,
      title: body.title,
      content: clone(body.content),
      editSummary: body.editSummary || "Create page",
      authorEmail: coreState().account?.email || "cursor-owner",
      authorName: coreState().account?.name || "Cursor Testing Owner",
      authorRole: "owner",
      createdAt: now,
    };
    const page = withTestingPermissions({
      id: randomId("local-page"),
      slug: body.slug,
      title: body.title,
      allowNormalEdits: true,
      createdAt: now,
      updatedAt: now,
      createdBy: revision.authorEmail,
      updatedBy: revision.authorEmail,
      currentRevision: revision,
      localRevisions: [revision],
    });
    const overrides = readLocalOverrides();
    overrides[page.slug] = page;
    writeLocalOverrides(overrides);
    return { ok: true, page };
  }

  async function mutatePage(slug, body) {
    if (!isTesting()) {
      return remoteRequest({ slug, method: "PATCH", body });
    }
    let page = testingPages({ includeDeleted: body.action === "restore_from_trash" })
      .find((candidate) => candidate.slug === slug);
    if (!page) {
      throw new Error("Wiki page not found.");
    }
    page = ensureLocalHistory(page);
    const now = new Date().toISOString();
    const actorEmail = coreState().account?.email || "cursor-owner";
    const actorName = coreState().account?.name || "Cursor Testing Owner";

    if (body.action === "move_page") {
      const newSlug = normalizeSlug(body.newSlug);
      if (
        !newSlug ||
        testingPages({ includeDeleted: true }).some((candidate) => candidate.slug === newSlug) ||
        Object.hasOwn(testingRedirects(), newSlug)
      ) {
        const error = new Error("That page address is already in use.");
        error.status = 409;
        throw error;
      }
      const oldSlug = page.slug;
      page.slug = newSlug;
      page.updatedAt = now;
      page.updatedBy = actorEmail;
      const overrides = readLocalOverrides();
      delete overrides[oldSlug];
      overrides[newSlug] = withTestingPermissions(page);
      writeLocalOverrides(overrides);
      const redirects = readLocalRedirects();
      redirects[oldSlug] = newSlug;
      writeLocalRedirects(redirects);
      return {
        ok: true,
        page: withTestingPermissions(page),
        moved: { oldSlug, newSlug, redirectCreated: true },
      };
    } else if (body.action === "trash_page") {
      page.isDeleted = true;
      page.deletedAt = now;
      page.updatedAt = now;
      page.updatedBy = actorEmail;
    } else if (body.action === "restore_from_trash") {
      page.isDeleted = false;
      page.deletedAt = null;
      page.updatedAt = now;
      page.updatedBy = actorEmail;
    } else if (body.action === "update_page_settings") {
      page.allowNormalEdits = Boolean(body.allowNormalEdits);
      page.updatedAt = now;
      page.updatedBy = actorEmail;
    } else if (body.action === "restore_revision") {
      if (body.baseRevisionId !== page.currentRevision?.id) {
        const error = new Error("This page changed after the history was opened. Reload before restoring.");
        error.status = 409;
        error.code = "revision_conflict";
        throw error;
      }
      const selected = page.localRevisions.find((revision) => revision.id === body.revisionId);
      if (!selected) {
        throw new Error("The revision selected for restoration was not found.");
      }
      const revision = {
        id: randomId("local-revision"),
        number: Number(page.currentRevision?.number || 0) + 1,
        title: selected.title || page.title,
        content: clone(selected.content),
        editSummary: body.editSummary || `Restore revision ${selected.number}`,
        authorEmail: actorEmail,
        authorName: actorName,
        authorRole: "owner",
        createdAt: now,
      };
      page.localRevisions.push(revision);
      page.currentRevision = revision;
      page.title = revision.title;
      page.updatedAt = now;
      page.updatedBy = actorEmail;
    } else {
      if (body.baseRevisionId !== page.currentRevision?.id) {
        const error = new Error("This page changed after you opened it. Reload before saving.");
        error.status = 409;
        error.code = "revision_conflict";
        throw error;
      }
      const revision = {
        id: randomId("local-revision"),
        number: Number(page.currentRevision?.number || 0) + 1,
        title: body.title,
        content: clone(body.content),
        editSummary: body.editSummary || "",
        authorEmail: actorEmail,
        authorName: actorName,
        authorRole: "owner",
        createdAt: now,
      };
      page.title = body.title;
      page.localRevisions.push(revision);
      page.currentRevision = revision;
      page.updatedAt = now;
      page.updatedBy = actorEmail;
    }

    const saved = withTestingPermissions(page);
    const overrides = readLocalOverrides();
    overrides[saved.slug] = saved;
    writeLocalOverrides(overrides);
    return { ok: true, page: saved };
  }

  function updateBrowserAddress(slug, replace = false) {
    let target;
    if (isTesting() || /wiki\.html$/i.test(window.location.pathname)) {
      target = new URL(window.location.href);
      target.searchParams.delete("history");
      if (slug === "front-page") {
        target.searchParams.delete("page");
      } else {
        target.searchParams.set("page", slug);
      }
    } else {
      target = new URL(slug === "front-page" ? "/wiki" : `/wiki/${slug}`, window.location.origin);
    }
    window.history[replace ? "replaceState" : "pushState"]({ wikiSlug: slug }, "", target);
  }

  function sanitizeInlineHtml(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");

    function cleanNode(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) {
          return;
        }
        if (!ALLOWED_INLINE_TAGS.has(child.tagName)) {
          cleanNode(child);
          child.replaceWith(...child.childNodes);
          return;
        }

        const href = child.tagName === "A" ? String(child.getAttribute("href") || "").trim() : "";
        [...child.attributes].forEach((attribute) => child.removeAttribute(attribute.name));
        if (child.tagName === "A" && href) {
          try {
            const parsed = new URL(href, window.location.origin);
            if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
              child.setAttribute("href", href);
              child.setAttribute("rel", "noopener noreferrer");
            }
          } catch (error) {
            // Invalid links become plain styled text.
          }
        }
        cleanNode(child);
      });
    }

    cleanNode(template.content);
    return template.innerHTML;
  }

  function setInlineContent(element, block) {
    const html = block?.html;
    if (typeof html === "string") {
      element.innerHTML = sanitizeInlineHtml(html);
    } else {
      element.textContent = String(block?.text || "");
    }
  }

  async function hydrateMediaImages(container) {
    const images = [...container.querySelectorAll("img[data-wiki-media-id]")];
    await Promise.all(images.map(async (imageElement) => {
      if (imageElement.dataset.mediaLoading === "1" || imageElement.src) {
        return;
      }
      imageElement.dataset.mediaLoading = "1";
      const loading = imageElement.closest("figure")?.querySelector(".wiki-image-loading");
      try {
        const blob = await fetchProtectedMedia(imageElement.dataset.wikiMediaId);
        const objectUrl = URL.createObjectURL(blob);
        imageElement.src = objectUrl;
        imageElement.addEventListener("load", () => loading?.remove(), { once: true });
        imageElement.hidden = false;
      } catch (error) {
        if (loading) {
          loading.textContent = error?.message || "This wiki image could not be loaded.";
        }
      }
    }));
  }

  function renderContent(container, content) {
    container.replaceChildren();
    const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
    if (!blocks.length) {
      const empty = document.createElement("p");
      empty.className = "article-empty";
      empty.textContent = "This page does not have any content yet.";
      container.append(empty);
      return;
    }

    blocks.forEach((block) => {
      const type = BLOCK_TYPES.has(block?.type) ? block.type : "paragraph";
      let element;
      if (type === "image") {
        element = document.createElement("figure");
        element.contentEditable = "false";
        element.dataset.wikiMediaId = String(block.mediaId || "");
        element.dataset.wikiMediaUrl = String(block.url || "");
        const image = document.createElement("img");
        image.alt = String(block.alt || "").slice(0, 240);
        image.dataset.wikiMediaId = String(block.mediaId || "");
        const directUrl = String(block.url || "");
        if (/^(?:data:image\/|blob:)/i.test(directUrl)) {
          image.src = directUrl;
        } else if (block.mediaId) {
          image.hidden = true;
          const loading = document.createElement("span");
          loading.className = "wiki-image-loading";
          loading.textContent = "Loading protected wiki image...";
          element.append(loading);
        }
        element.append(image);
        if (String(block.caption || "").trim()) {
          const caption = document.createElement("figcaption");
          caption.textContent = String(block.caption).trim().slice(0, 300);
          element.append(caption);
        }
      } else if (type === "heading2" || type === "heading3") {
        element = document.createElement(type === "heading2" ? "h2" : "h3");
        setInlineContent(element, block);
      } else if (type === "bullet-list" || type === "numbered-list") {
        element = document.createElement(type === "bullet-list" ? "ul" : "ol");
        const items = Array.isArray(block.items)
          ? block.items
          : String(block.text || "").split("\n");
        items.forEach((item) => {
          const listItem = document.createElement("li");
          if (item && typeof item === "object") {
            setInlineContent(listItem, item);
          } else {
            listItem.textContent = String(item || "");
          }
          if (listItem.textContent.trim() || listItem.querySelector("br")) {
            element.append(listItem);
          }
        });
      } else if (type === "callout") {
        element = document.createElement("blockquote");
        element.className = "article-callout";
        setInlineContent(element, block);
      } else {
        element = document.createElement("p");
        setInlineContent(element, block);
      }
      container.append(element);
    });
    hydrateMediaImages(container);
  }

  function normalizeEditableRoot() {
    if (!ui.content.children.length) {
      const paragraph = document.createElement("p");
      paragraph.append(document.createElement("br"));
      ui.content.append(paragraph);
    }
  }

  function serializeInlineElement(element) {
    return {
      html: sanitizeInlineHtml(element.innerHTML),
      text: element.textContent || "",
    };
  }

  function serializeEditorContent() {
    const blocks = [];
    [...ui.content.childNodes].forEach((node, index) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = String(node.textContent || "").trim();
        if (text) {
          blocks.push({ id: randomId(`block-${index}`), type: "paragraph", text });
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const tag = node.tagName;
      if (tag === "FIGURE" && node.dataset.wikiMediaId) {
        const image = node.querySelector("img");
        const caption = node.querySelector("figcaption");
        blocks.push({
          id: randomId(`block-${index}`),
          type: "image",
          mediaId: node.dataset.wikiMediaId,
          url: node.dataset.wikiMediaUrl || "",
          alt: String(image?.alt || "").slice(0, 240),
          caption: String(caption?.textContent || "").trim().slice(0, 300),
        });
        return;
      }
      if (tag === "UL" || tag === "OL") {
        blocks.push({
          id: randomId(`block-${index}`),
          type: tag === "UL" ? "bullet-list" : "numbered-list",
          items: [...node.querySelectorAll(":scope > li")].map((item) => serializeInlineElement(item)),
        });
        return;
      }
      const type = tag === "H2"
        ? "heading2"
        : tag === "H3"
          ? "heading3"
          : tag === "BLOCKQUOTE" || node.classList.contains("article-callout")
            ? "callout"
            : "paragraph";
      blocks.push({
        id: randomId(`block-${index}`),
        type,
        ...serializeInlineElement(node),
      });
    });

    return {
      type: "document",
      version: 2,
      blocks: blocks.length
        ? blocks
        : [{ id: randomId("block"), type: "paragraph", text: "" }],
    };
  }

  function contentPlainText(content) {
    const temporary = document.createElement("div");
    renderContent(temporary, content);
    return temporary.textContent.replace(/\s+/g, " ").trim();
  }

  function compareContents(selected, current) {
    const selectedBlocks = Array.isArray(selected?.blocks) ? selected.blocks : [];
    const currentBlocks = Array.isArray(current?.blocks) ? current.blocks : [];
    const maximum = Math.max(selectedBlocks.length, currentBlocks.length);
    let changed = 0;
    const comparableBlock = (block) => {
      if (!block || typeof block !== "object") {
        return block || null;
      }
      const { id, ...content } = block;
      return content;
    };
    for (let index = 0; index < maximum; index += 1) {
      if (
        JSON.stringify(comparableBlock(selectedBlocks[index])) !==
        JSON.stringify(comparableBlock(currentBlocks[index]))
      ) {
        changed += 1;
      }
    }
    const selectedWords = contentPlainText(selected).split(/\s+/).filter(Boolean).length;
    const currentWords = contentPlainText(current).split(/\s+/).filter(Boolean).length;
    return changed === 0
      ? "This revision has the same article content as the current revision."
      : `${changed} of ${maximum} content block${maximum === 1 ? "" : "s"} differ · ${selectedWords} selected words vs. ${currentWords} current words.`;
  }

  function updateDocumentTitle(page) {
    document.title = `${page.title} | Carbon Frontier Wiki`;
  }

  function renderSearchResults() {
    const query = ui.searchMenuInput.value.trim().toLowerCase();
    const visiblePages = [...app.pages]
      .filter((page) => `${page.title} ${page.slug}`.toLowerCase().includes(query))
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
      .slice(0, query ? 40 : 12);
    ui.searchResults.replaceChildren();
    app.searchIndex = -1;

    const label = document.createElement("p");
    label.className = "search-results-label";
    label.textContent = query ? `Results for “${ui.searchMenuInput.value.trim()}”` : "Recently updated";
    ui.searchResults.append(label);

    if (!visiblePages.length) {
      const empty = document.createElement("p");
      empty.className = "wiki-list-state";
      empty.textContent = query ? "No wiki pages match that search." : "No wiki pages exist yet.";
      ui.searchResults.append(empty);
    } else {
      visiblePages.forEach((page) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `wiki-search-result${page.slug === app.currentSlug ? " is-active" : ""}`;
        button.dataset.slug = page.slug;
        const icon = document.createElement("span");
        icon.className = "search-result-icon";
        icon.textContent = "▤";
        const copy = document.createElement("span");
        copy.className = "search-result-copy";
        const title = document.createElement("strong");
        title.textContent = page.title;
        const meta = document.createElement("span");
        meta.textContent = page.revisionNumber
          ? `Revision ${page.revisionNumber} · ${formatDate(page.updatedAt)}`
          : `Updated ${formatDate(page.updatedAt)}`;
        copy.append(title, meta);
        const openHint = document.createElement("small");
        openHint.textContent = page.slug === app.currentSlug ? "Current" : "Open →";
        button.append(icon, copy, openHint);
        ui.searchResults.append(button);
      });
    }
  }

  function openSearchMenu() {
    if (app.editing || ui.search.disabled) {
      return;
    }
    ui.searchMenuInput.value = "";
    renderSearchResults();
    setDialog(ui.searchDialog, true);
    ui.search.blur();
    window.requestAnimationFrame(() => {
      ui.searchMenuInput.focus({ preventScroll: true });
      ui.searchMenuInput.setSelectionRange(0, 0);
    });
  }

  function closeSearchResults() {
    setDialog(ui.searchDialog, false);
    ui.searchMenuInput.value = "";
    app.searchIndex = -1;
  }

  function renderPage(page) {
    app.currentPage = page;
    ui.breadcrumb.textContent = page.slug === "front-page" ? "Wiki front page" : "Wiki article";
    ui.title.textContent = page.title;
    const revision = page.currentRevision;
    const author = authorLabel(revision);
    ui.meta.textContent = revision
      ? `Revision ${revision.number} · ${formatDate(revision.createdAt)} · ${author}`
      : "No saved revision.";
    renderContent(ui.content, revision?.content);
    ui.editPage.hidden = !page.permissions?.canEdit;
    ui.historyButton.hidden = true;
    ui.pageSettings.hidden = true;
    updateDocumentTitle(page);
  }

  function renderPageError(error) {
    app.currentPage = null;
    ui.breadcrumb.textContent = "Wiki article";
    ui.title.textContent = error?.status === 404 ? "Page not found" : "Page unavailable";
    ui.meta.textContent = "";
    ui.editPage.hidden = true;
    ui.historyButton.hidden = true;
    ui.content.replaceChildren();
    const message = document.createElement("p");
    message.className = "article-empty";
    message.textContent = error?.message || "This wiki page could not be loaded.";
    ui.content.append(message);
  }

  async function refreshPageList() {
    const payload = await listPages();
    app.pages = Array.isArray(payload.pages) ? payload.pages : [];
    app.pageListPermissions = payload.permissions || {};
    ui.topTools.hidden = false;
    ui.newPage.hidden = !payload.permissions?.canCreate;
    ui.openTrash.hidden = !payload.permissions?.canManageTrash;
    ui.searchActions.hidden = ui.newPage.hidden && ui.openTrash.hidden;
    if (!ui.searchDialog.hidden) {
      renderSearchResults();
    }
  }

  async function openPage(slug, { push = true } = {}) {
    const normalized = normalizeSlug(slug) || "front-page";
    if (app.editing) {
      exitEditing({ restorePage: true });
    }
    app.currentSlug = normalized;
    if (push) {
      updateBrowserAddress(normalized);
    }
    closeSearchResults();
    setFeedback(ui.feedback, "Loading page...");
    try {
      const payload = await getPage(normalized);
      if (payload.redirect?.targetSlug) {
        app.currentSlug = payload.redirect.targetSlug;
        updateBrowserAddress(payload.redirect.targetSlug, true);
      }
      renderPage(payload.page);
      setFeedback(ui.feedback, "");
    } catch (error) {
      renderPageError(error);
      setFeedback(ui.feedback, error?.message || "The page could not be loaded.", true);
    }
  }

  function openNewPageDialog() {
    if (app.editing) {
      return;
    }
    closeSearchResults();
    ui.newForm.reset();
    app.slugManuallyEdited = false;
    ui.createPage.textContent = app.pageListPermissions?.submitsForReview
      ? "Submit for Review"
      : "Create Page";
    setFeedback(ui.newFeedback, "");
    setDialog(ui.newDialog, true);
    window.setTimeout(() => ui.newTitle.focus(), 0);
  }

  function closeNewPageDialog() {
    setDialog(ui.newDialog, false);
  }

  function enterEditing() {
    const page = app.currentPage;
    if (!page?.permissions?.canEdit || app.editing) {
      return;
    }
    app.editing = true;
    app.editingBasePage = clone(page);
    ui.articleSurface.classList.add("is-editing");
    ui.documentToolbar.hidden = false;
    ui.title.hidden = true;
    ui.titleInput.hidden = false;
    ui.titleInput.value = page.title;
    ui.meta.textContent = `Editing revision ${page.currentRevision?.number || 0}`;
    ui.editPage.hidden = true;
    ui.historyButton.hidden = !page.currentRevision;
    ui.pageSettings.hidden = !page.permissions?.canManagePage;
    ui.normalEdits.checked = Boolean(page.allowNormalEdits);
    ui.normalEdits.disabled = !page.permissions?.canChangePageSettings;
    ui.normalEditsField.hidden = !page.permissions?.canChangePageSettings;
    ui.editSummary.value = "";
    ui.savePage.textContent = page.permissions?.submitsForReview ? "Submit" : "Save";
    ui.content.contentEditable = "true";
    ui.content.setAttribute("role", "textbox");
    ui.content.setAttribute("aria-multiline", "true");
    normalizeEditableRoot();
    ui.search.disabled = true;
    ui.newPage.disabled = true;
    closeSearchResults();
    setFeedback(ui.feedback, "Editing mode active. Select text and use the toolbar to format it.");
    window.setTimeout(() => ui.content.focus(), 0);
  }

  function exitEditing({ restorePage = false } = {}) {
    if (!app.editing) {
      return;
    }
    app.editing = false;
    ui.articleSurface.classList.remove("is-editing");
    ui.documentToolbar.hidden = true;
    ui.linkPopover.hidden = true;
    ui.title.hidden = false;
    ui.titleInput.hidden = true;
    ui.content.contentEditable = "false";
    ui.content.removeAttribute("role");
    ui.content.removeAttribute("aria-multiline");
    ui.search.disabled = false;
    ui.newPage.disabled = false;
    ui.historyButton.hidden = true;
    ui.pageSettings.hidden = true;
    ui.savePage.textContent = "Save";
    if (restorePage && app.editingBasePage) {
      renderPage(app.editingBasePage);
    }
    app.savedSelection = null;
    app.editingBasePage = null;
  }

  function executeEditorCommand(command, value = null) {
    if (!app.editing) {
      return;
    }
    ui.content.focus();
    restoreSavedSelection();
    document.execCommand(command, false, value);
    normalizeEditableRoot();
    saveCurrentSelection();
    updateToolbarState();
  }

  function updateToolbarState() {
    if (!app.editing) {
      return;
    }
    [
      [ui.bold, "bold"],
      [ui.italic, "italic"],
      [ui.underline, "underline"],
      [ui.bullets, "insertUnorderedList"],
      [ui.numbers, "insertOrderedList"],
    ].forEach(([button, command]) => {
      button.classList.toggle("is-active", document.queryCommandState(command));
    });
  }

  function saveCurrentSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !ui.content.contains(selection.anchorNode)) {
      return false;
    }
    app.savedSelection = selection.getRangeAt(0).cloneRange();
    return true;
  }

  function restoreSavedSelection() {
    if (!app.savedSelection) {
      return false;
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(app.savedSelection);
    return true;
  }

  function openLinkPopover() {
    saveCurrentSelection();
    if (!app.savedSelection || app.savedSelection.collapsed) {
      setFeedback(ui.feedback, "Select some text first, then click Link.", true);
      return;
    }
    ui.linkPopover.hidden = false;
    ui.linkUrl.value = "";
    window.setTimeout(() => ui.linkUrl.focus(), 0);
  }

  function closeLinkPopover() {
    ui.linkPopover.hidden = true;
    app.savedSelection = null;
  }

  async function saveEditing() {
    const page = app.editingBasePage;
    if (!page?.currentRevision?.id) {
      setFeedback(ui.feedback, "This page has no revision to edit.", true);
      return;
    }
    const title = ui.titleInput.value.trim();
    if (!title) {
      setFeedback(ui.feedback, "Enter a page title before saving.", true);
      ui.titleInput.focus();
      return;
    }

    ui.savePage.disabled = true;
    setFeedback(ui.feedback, "Saving a new revision...");
    try {
      if (
        page.permissions?.canChangePageSettings &&
        Boolean(page.allowNormalEdits) !== ui.normalEdits.checked
      ) {
        await mutatePage(page.slug, {
          action: "update_page_settings",
          allowNormalEdits: ui.normalEdits.checked,
        });
      }

      const payload = await mutatePage(page.slug, {
        title,
        content: serializeEditorContent(),
        editSummary: ui.editSummary.value.trim(),
        baseRevisionId: page.currentRevision.id,
      });
      if (payload.pendingReview) {
        app.currentPage = payload.page || page;
        exitEditing();
        renderPage(app.currentPage);
        setFeedback(
          ui.feedback,
          "Your edit was submitted for approval. The current article stays unchanged until an Owner or Admin approves it."
        );
        return;
      }
      app.currentPage = payload.page;
      exitEditing();
      renderPage(payload.page);
      await refreshPageList();
      setFeedback(ui.feedback, `Revision ${payload.page.currentRevision.number} saved.`);
    } catch (error) {
      const conflict = error?.code === "revision_conflict" || error?.status === 409;
      setFeedback(
        ui.feedback,
        conflict
          ? "Someone saved this page after you opened it. Cancel editing, reload the page, and apply your change again."
          : error?.message || "The revision could not be saved.",
        true
      );
    } finally {
      ui.savePage.disabled = false;
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    const title = ui.newTitle.value.trim();
    const slug = normalizeSlug(ui.newSlug.value);
    const intro = ui.newIntro.value.trim();
    if (!title || !slug || !intro) {
      setFeedback(ui.newFeedback, "Complete the title, page address, and opening paragraph.", true);
      return;
    }
    ui.createPage.disabled = true;
    setFeedback(ui.newFeedback, "Creating page...");
    try {
      const payload = await createPage({
        title,
        slug,
        content: {
          type: "document",
          version: 2,
          blocks: [{ id: randomId("block"), type: "paragraph", text: intro }],
        },
        editSummary: "Create page",
      });
      if (payload.pendingReview) {
        closeNewPageDialog();
        setFeedback(
          ui.feedback,
          `“${title}” was submitted for approval. It will appear after an Owner or Admin approves it.`
        );
        return;
      }
      closeNewPageDialog();
      await refreshPageList();
      await openPage(payload.page.slug);
      setFeedback(ui.feedback, "Page created. Normal contributor editing is enabled by default.");
    } catch (error) {
      setFeedback(ui.newFeedback, error?.message || "The page could not be created.", true);
    } finally {
      ui.createPage.disabled = false;
    }
  }

  function openMediaDialog() {
    if (!app.editing) {
      return;
    }
    saveCurrentSelection();
    ui.mediaForm.reset();
    ui.mediaPreview.textContent = "Choose a PNG, JPG, WebP, or GIF up to 4 MB.";
    setFeedback(ui.mediaFeedback, "");
    setDialog(ui.mediaDialog, true);
    window.setTimeout(() => ui.mediaFile.focus(), 0);
  }

  function closeMediaDialog() {
    setDialog(ui.mediaDialog, false);
  }

  function previewMediaFile() {
    const file = ui.mediaFile.files?.[0];
    ui.mediaPreview.replaceChildren();
    if (!file) {
      ui.mediaPreview.textContent = "Choose a PNG, JPG, WebP, or GIF up to 4 MB.";
      return;
    }
    if (app.mediaPreviewUrl) {
      URL.revokeObjectURL(app.mediaPreviewUrl);
    }
    app.mediaPreviewUrl = URL.createObjectURL(file);
    const image = document.createElement("img");
    image.src = app.mediaPreviewUrl;
    image.alt = "Selected image preview";
    ui.mediaPreview.append(image);
    if (!ui.mediaAlt.value.trim()) {
      ui.mediaAlt.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    }
  }

  function insertUploadedImage(media, { alt, caption }) {
    const figure = document.createElement("figure");
    figure.contentEditable = "false";
    figure.dataset.wikiMediaId = media.id;
    figure.dataset.wikiMediaUrl = media.url || "";
    const image = document.createElement("img");
    image.alt = alt;
    image.src = isTesting() ? media.url : app.mediaPreviewUrl;
    figure.append(image);
    if (caption) {
      const captionElement = document.createElement("figcaption");
      captionElement.textContent = caption;
      figure.append(captionElement);
    }

    const selection = window.getSelection();
    if (restoreSavedSelection() && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      range.collapse(false);
      range.insertNode(figure);
      const paragraph = document.createElement("p");
      paragraph.append(document.createElement("br"));
      figure.after(paragraph);
      range.setStart(paragraph, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      ui.content.append(figure);
    }
    closeMediaDialog();
    ui.content.focus();
    setFeedback(ui.feedback, "Image inserted. Save the page to publish it.");
  }

  async function handleMediaUpload(event) {
    event.preventDefault();
    const file = ui.mediaFile.files?.[0];
    const alt = ui.mediaAlt.value.trim();
    const caption = ui.mediaCaption.value.trim();
    if (!file) {
      setFeedback(ui.mediaFeedback, "Choose an image first.", true);
      return;
    }
    if (!alt) {
      setFeedback(ui.mediaFeedback, "Add alt text describing the image.", true);
      ui.mediaAlt.focus();
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFeedback(ui.mediaFeedback, "Wiki images must be 4 MB or smaller.", true);
      return;
    }
    ui.uploadMedia.disabled = true;
    setFeedback(ui.mediaFeedback, "Uploading protected wiki image...");
    try {
      const payload = await uploadMediaFile(file);
      insertUploadedImage(payload.media, { alt, caption });
    } catch (error) {
      setFeedback(ui.mediaFeedback, error?.message || "The image could not be uploaded.", true);
    } finally {
      ui.uploadMedia.disabled = false;
    }
  }

  function openPageManagement() {
    const page = app.currentPage;
    if (!app.editing || !page?.permissions?.canManagePage) {
      return;
    }
    ui.managementTitle.textContent = `${page.title} settings`;
    ui.managementNormalEdits.checked = Boolean(page.allowNormalEdits);
    ui.moveSlug.value = page.slug;
    ui.moveSlug.disabled = page.slug === "front-page";
    ui.movePage.disabled = page.slug === "front-page";
    ui.trashPage.disabled = page.slug === "front-page";
    ui.trashPage.textContent = "Move to Trash";
    app.trashArmedSlug = "";
    setFeedback(ui.managementFeedback, "");
    setDialog(ui.managementDialog, true);
  }

  function closePageManagement() {
    setDialog(ui.managementDialog, false);
    app.trashArmedSlug = "";
  }

  async function updateManagedEditingPermission() {
    const page = app.currentPage;
    if (!page?.permissions?.canManagePage) {
      return;
    }
    ui.managementNormalEdits.disabled = true;
    try {
      const payload = await mutatePage(page.slug, {
        action: "update_page_settings",
        allowNormalEdits: ui.managementNormalEdits.checked,
      });
      app.currentPage = payload.page;
      app.editingBasePage.allowNormalEdits = payload.page.allowNormalEdits;
      ui.normalEdits.checked = payload.page.allowNormalEdits;
      await refreshPageList();
      setFeedback(ui.managementFeedback, payload.page.allowNormalEdits
        ? "Normal contributor editing enabled."
        : "Page protected from normal contributor editing.");
    } catch (error) {
      ui.managementNormalEdits.checked = Boolean(page.allowNormalEdits);
      setFeedback(ui.managementFeedback, error?.message || "The page permission could not be changed.", true);
    } finally {
      ui.managementNormalEdits.disabled = false;
    }
  }

  async function moveManagedPage() {
    const page = app.currentPage;
    const newSlug = slugify(ui.moveSlug.value);
    ui.moveSlug.value = newSlug;
    if (!page?.permissions?.canManagePage || !newSlug || newSlug === page.slug) {
      setFeedback(ui.managementFeedback, "Enter a different valid page address.", true);
      return;
    }
    ui.movePage.disabled = true;
    setFeedback(ui.managementFeedback, "Moving page and creating redirect...");
    try {
      const payload = await mutatePage(page.slug, { action: "move_page", newSlug });
      const oldSlug = page.slug;
      app.currentSlug = payload.page.slug;
      app.currentPage = payload.page;
      app.editingBasePage.slug = payload.page.slug;
      updateBrowserAddress(payload.page.slug, true);
      ui.moveSlug.value = payload.page.slug;
      await refreshPageList();
      setFeedback(ui.managementFeedback, `Moved. /wiki/${oldSlug} now redirects here.`);
      setFeedback(ui.feedback, "Page moved. Your unsaved article edits are still open.");
    } catch (error) {
      setFeedback(ui.managementFeedback, error?.message || "The page could not be moved.", true);
    } finally {
      ui.movePage.disabled = false;
    }
  }

  async function trashManagedPage() {
    const page = app.currentPage;
    if (!page?.permissions?.canManagePage || page.slug === "front-page") {
      return;
    }
    if (app.trashArmedSlug !== page.slug) {
      app.trashArmedSlug = page.slug;
      ui.trashPage.textContent = "Confirm Move to Trash";
      setFeedback(ui.managementFeedback, "Unsaved edits will be discarded. Click again to confirm.");
      return;
    }
    ui.trashPage.disabled = true;
    setFeedback(ui.managementFeedback, "Moving page to recoverable trash...");
    try {
      await mutatePage(page.slug, { action: "trash_page" });
      closePageManagement();
      exitEditing();
      await refreshPageList();
      await openPage("front-page");
      setFeedback(ui.feedback, `“${page.title}” was moved to Trash and can be restored.`);
    } catch (error) {
      setFeedback(ui.managementFeedback, error?.message || "The page could not be moved to trash.", true);
    } finally {
      ui.trashPage.disabled = false;
    }
  }

  async function openTrashDialog() {
    closeSearchResults();
    setDialog(ui.trashDialog, true);
    ui.trashList.innerHTML = '<p class="wiki-list-state">Loading trashed pages...</p>';
    setFeedback(ui.trashFeedback, "");
    try {
      const payload = await listTrashPages();
      renderTrashList(Array.isArray(payload.pages) ? payload.pages : []);
    } catch (error) {
      ui.trashList.replaceChildren();
      setFeedback(ui.trashFeedback, error?.message || "The wiki trash could not be loaded.", true);
    }
  }

  function closeTrashDialog() {
    setDialog(ui.trashDialog, false);
  }

  function renderTrashList(pages) {
    ui.trashList.replaceChildren();
    if (!pages.length) {
      const empty = document.createElement("p");
      empty.className = "wiki-list-state";
      empty.textContent = "Trash is empty.";
      ui.trashList.append(empty);
      return;
    }
    pages.forEach((page) => {
      const row = document.createElement("div");
      row.className = "trash-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = page.title;
      const meta = document.createElement("span");
      meta.textContent = `${page.slug} · Trashed ${formatDate(page.deletedAt || page.updatedAt)}`;
      copy.append(title, meta);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "secondary-button";
      restore.dataset.restoreSlug = page.slug;
      restore.textContent = "Restore";
      row.append(copy, restore);
      ui.trashList.append(row);
    });
  }

  async function restoreTrashedPage(slug, button) {
    button.disabled = true;
    setFeedback(ui.trashFeedback, "Restoring page...");
    try {
      const payload = await mutatePage(slug, { action: "restore_from_trash" });
      await refreshPageList();
      const trashPayload = await listTrashPages();
      renderTrashList(Array.isArray(trashPayload.pages) ? trashPayload.pages : []);
      setFeedback(ui.trashFeedback, `“${payload.page.title}” restored.`);
    } catch (error) {
      setFeedback(ui.trashFeedback, error?.message || "The page could not be restored.", true);
      button.disabled = false;
    }
  }

  function renderHistoryList() {
    ui.historyList.replaceChildren();
    if (!app.history.length) {
      const empty = document.createElement("p");
      empty.className = "wiki-list-state";
      empty.textContent = "No revisions are available.";
      ui.historyList.append(empty);
      return;
    }
    app.history.forEach((revision) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `history-revision-button${
        revision.id === app.selectedRevision?.id ? " is-selected" : ""
      }`;
      button.dataset.revisionNumber = String(revision.number);
      const title = document.createElement("strong");
      title.textContent = `Revision ${revision.number}${revision.isCurrent ? " · Current" : ""}`;
      const author = document.createElement("span");
      author.textContent = authorLabel(revision);
      const date = document.createElement("span");
      date.textContent = formatDate(revision.createdAt);
      const summary = document.createElement("span");
      summary.textContent = revision.editSummary || "No edit summary";
      button.append(title, author, date, summary);
      ui.historyList.append(button);
    });
  }

  async function selectRevision(number) {
    setFeedback(ui.historyFeedback, "Loading revision...");
    try {
      const payload = await getRevision(app.currentPage.slug, number);
      app.selectedRevision = payload.revision;
      app.restoreArmedRevisionId = "";
      renderHistoryList();
      ui.historySelectionLabel.textContent = payload.revision.isCurrent
        ? "Current version"
        : "Older version";
      ui.historySelectionTitle.textContent = `Revision ${payload.revision.number}`;
      ui.historySelectionMeta.textContent = `${formatDate(payload.revision.createdAt)} · ${
        authorLabel(payload.revision)
      } · ${payload.revision.editSummary || "No edit summary"}`;
      renderContent(ui.selectedPreview, payload.revision.content);
      renderContent(ui.currentPreview, app.currentPage.currentRevision?.content);
      ui.historyDiffSummary.textContent = compareContents(
        payload.revision.content,
        app.currentPage.currentRevision?.content
      );
      if ((payload.revision.title || app.currentPage.title) !== app.currentPage.title) {
        ui.historyDiffSummary.textContent = `Title: “${payload.revision.title}” → “${app.currentPage.title}” · ${ui.historyDiffSummary.textContent}`;
      }
      ui.restoreRevision.hidden =
        payload.revision.isCurrent || !app.currentPage.permissions?.canRestoreRevisions;
      ui.restoreRevision.textContent = "Restore This Revision";
      setFeedback(ui.historyFeedback, "");
    } catch (error) {
      setFeedback(ui.historyFeedback, error?.message || "The revision could not be loaded.", true);
    }
  }

  async function openHistory() {
    if (!app.currentPage?.currentRevision) {
      return;
    }
    setDialog(ui.historyDialog, true);
    ui.historyTitle.textContent = `${app.currentPage.title} history`;
    ui.historyList.innerHTML = '<p class="wiki-list-state">Loading revisions...</p>';
    ui.selectedPreview.replaceChildren();
    ui.currentPreview.replaceChildren();
    ui.historyDiffSummary.textContent = "";
    ui.restoreRevision.hidden = true;
    setFeedback(ui.historyFeedback, "");
    try {
      const payload = await getHistory(app.currentPage.slug);
      app.history = Array.isArray(payload.revisions) ? payload.revisions : [];
      renderHistoryList();
      const firstOlder = app.history.find((revision) => !revision.isCurrent);
      const initial = firstOlder || app.history[0];
      if (initial) {
        await selectRevision(initial.number);
      }
    } catch (error) {
      ui.historyList.replaceChildren();
      setFeedback(ui.historyFeedback, error?.message || "Revision history could not be loaded.", true);
    }
  }

  function closeHistory() {
    setDialog(ui.historyDialog, false);
    app.history = [];
    app.selectedRevision = null;
    app.restoreArmedRevisionId = "";
  }

  async function restoreSelectedRevision() {
    const revision = app.selectedRevision;
    const page = app.currentPage;
    if (!revision || revision.isCurrent || !page?.permissions?.canRestoreRevisions) {
      return;
    }
    if (app.restoreArmedRevisionId !== revision.id) {
      app.restoreArmedRevisionId = revision.id;
      ui.restoreRevision.textContent = `Confirm Restore Revision ${revision.number}`;
      setFeedback(
        ui.historyFeedback,
        "Restoring creates a new revision; it does not delete any newer history. Click again to confirm."
      );
      return;
    }

    ui.restoreRevision.disabled = true;
    setFeedback(ui.historyFeedback, "Restoring revision...");
    try {
      const payload = await mutatePage(page.slug, {
        action: "restore_revision",
        revisionId: revision.id,
        baseRevisionId: page.currentRevision.id,
        editSummary: `Restore revision ${revision.number}`,
      });
      app.currentPage = payload.page;
      closeHistory();
      exitEditing();
      renderPage(payload.page);
      await refreshPageList();
      setFeedback(
        ui.feedback,
        `Revision ${revision.number} was restored as new revision ${payload.page.currentRevision.number}.`
      );
    } catch (error) {
      setFeedback(ui.historyFeedback, error?.message || "The revision could not be restored.", true);
    } finally {
      ui.restoreRevision.disabled = false;
    }
  }

  async function initialize() {
    if (!core()) {
      return;
    }
    let attempts = 0;
    while (!coreState().access && attempts < 120) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      attempts += 1;
    }
    if (!viewer()?.canView) {
      return;
    }
    try {
      await refreshPageList();
      await openPage(app.currentSlug, { push: false });
    } catch (error) {
      renderPageError(error);
      setFeedback(ui.feedback, error?.message || "The wiki could not be loaded.", true);
    }
  }

  ui.search.addEventListener("click", openSearchMenu);
  ui.search.addEventListener("focus", openSearchMenu);
  ui.search.addEventListener("keydown", (event) => {
    if (["Enter", " ", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      openSearchMenu();
    }
  });
  ui.searchMenuInput.addEventListener("input", renderSearchResults);
  ui.searchMenuInput.addEventListener("keydown", (event) => {
    const buttons = [...ui.searchResults.querySelectorAll("[data-slug]")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      app.searchIndex = event.key === "ArrowDown"
        ? Math.min(app.searchIndex + 1, buttons.length - 1)
        : Math.max(app.searchIndex - 1, 0);
      buttons.forEach((button, index) => button.classList.toggle("is-active", index === app.searchIndex));
      buttons[app.searchIndex]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && app.searchIndex >= 0) {
      event.preventDefault();
      buttons[app.searchIndex]?.click();
    } else if (event.key === "Escape") {
      closeSearchResults();
    }
  });
  ui.searchResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-slug]");
    if (button) {
      openPage(button.dataset.slug);
    }
  });

  ui.newPage.addEventListener("click", openNewPageDialog);
  ui.openTrash.addEventListener("click", openTrashDialog);
  ui.closeSearch.addEventListener("click", closeSearchResults);
  ui.editPage.addEventListener("click", enterEditing);
  ui.historyButton.addEventListener("click", openHistory);
  ui.savePage.addEventListener("click", saveEditing);
  ui.cancelEditor.addEventListener("click", () => {
    exitEditing({ restorePage: true });
    setFeedback(ui.feedback, "Changes discarded.");
  });
  ui.undo.addEventListener("click", () => executeEditorCommand("undo"));
  ui.redo.addEventListener("click", () => executeEditorCommand("redo"));
  ui.bold.addEventListener("click", () => executeEditorCommand("bold"));
  ui.italic.addEventListener("click", () => executeEditorCommand("italic"));
  ui.underline.addEventListener("click", () => executeEditorCommand("underline"));
  ui.bullets.addEventListener("click", () => executeEditorCommand("insertUnorderedList"));
  ui.numbers.addEventListener("click", () => executeEditorCommand("insertOrderedList"));
  ui.image.addEventListener("click", openMediaDialog);
  ui.pageSettings.addEventListener("click", openPageManagement);
  ui.blockStyle.addEventListener("change", () => executeEditorCommand("formatBlock", ui.blockStyle.value));
  ui.link.addEventListener("click", openLinkPopover);
  ui.linkCancel.addEventListener("click", closeLinkPopover);
  ui.linkApply.addEventListener("click", () => {
    const url = ui.linkUrl.value.trim();
    if (!url || !restoreSavedSelection()) {
      setFeedback(ui.feedback, "Enter a link address and keep some text selected.", true);
      return;
    }
    try {
      const parsed = new URL(url.includes(":") ? url : `https://${url}`);
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
        throw new Error("Unsupported link type");
      }
      executeEditorCommand("createLink", parsed.href);
      closeLinkPopover();
    } catch (error) {
      setFeedback(ui.feedback, "Enter a valid http, https, or email link.", true);
    }
  });
  ui.content.addEventListener("keyup", updateToolbarState);
  ui.content.addEventListener("mouseup", updateToolbarState);
  ui.content.addEventListener("paste", (event) => {
    if (!app.editing) {
      return;
    }
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
  });
  document.addEventListener("selectionchange", () => {
    if (app.editing && saveCurrentSelection()) {
      updateToolbarState();
    }
  });

  ui.closeNew.addEventListener("click", closeNewPageDialog);
  ui.cancelNew.addEventListener("click", closeNewPageDialog);
  ui.newForm.addEventListener("submit", handleCreate);
  ui.newTitle.addEventListener("input", () => {
    if (!app.slugManuallyEdited) {
      ui.newSlug.value = slugify(ui.newTitle.value);
    }
  });
  ui.newSlug.addEventListener("input", () => {
    app.slugManuallyEdited = true;
    ui.newSlug.value = slugify(ui.newSlug.value);
  });

  ui.closeHistory.addEventListener("click", closeHistory);
  ui.historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-revision-number]");
    if (button) {
      selectRevision(Number(button.dataset.revisionNumber));
    }
  });
  ui.restoreRevision.addEventListener("click", restoreSelectedRevision);

  ui.mediaFile.addEventListener("change", previewMediaFile);
  ui.mediaForm.addEventListener("submit", handleMediaUpload);
  ui.closeMedia.addEventListener("click", closeMediaDialog);
  ui.cancelMedia.addEventListener("click", closeMediaDialog);

  ui.closeManagement.addEventListener("click", closePageManagement);
  ui.managementNormalEdits.addEventListener("change", updateManagedEditingPermission);
  ui.moveSlug.addEventListener("input", () => {
    ui.moveSlug.value = slugify(ui.moveSlug.value);
  });
  ui.movePage.addEventListener("click", moveManagedPage);
  ui.trashPage.addEventListener("click", trashManagedPage);

  ui.closeTrash.addEventListener("click", closeTrashDialog);
  ui.trashList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-restore-slug]");
    if (button) {
      restoreTrashedPage(button.dataset.restoreSlug, button);
    }
  });

  [
    ui.searchDialog,
    ui.newDialog,
    ui.historyDialog,
    ui.mediaDialog,
    ui.managementDialog,
    ui.trashDialog,
  ].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        if (dialog === ui.searchDialog) closeSearchResults();
        else if (dialog === ui.mediaDialog) closeMediaDialog();
        else if (dialog === ui.managementDialog) closePageManagement();
        else if (dialog === ui.trashDialog) closeTrashDialog();
        else setDialog(dialog, false);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (app.editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveEditing();
      return;
    }
    if (event.key !== "Escape") {
      if (!app.editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearchMenu();
      }
      return;
    }
    if (!ui.linkPopover.hidden) {
      closeLinkPopover();
    } else if (!ui.mediaDialog.hidden) {
      closeMediaDialog();
    } else if (!ui.managementDialog.hidden) {
      closePageManagement();
    } else if (!ui.trashDialog.hidden) {
      closeTrashDialog();
    } else if (!ui.historyDialog.hidden) {
      closeHistory();
    } else if (!ui.newDialog.hidden) {
      closeNewPageDialog();
    } else if (!ui.searchDialog.hidden) {
      closeSearchResults();
    }
  });

  window.addEventListener("popstate", () => {
    app.currentSlug = slugFromLocation();
    openPage(app.currentSlug, { push: false });
  });
  window.addEventListener("carbon-frontier-testing-snapshot-updated", async () => {
    if (!isTesting() || !viewer()?.canView) {
      return;
    }
    await refreshPageList();
    await openPage(app.currentSlug, { push: false });
  });
  window.addEventListener("carbon-frontier-wiki-access-updated", async () => {
    if (!viewer()?.canView) {
      ui.topTools.hidden = true;
      closeSearchResults();
      return;
    }
    await refreshPageList();
    await openPage(app.currentSlug, { push: false });
  });

  initialize();
})();
