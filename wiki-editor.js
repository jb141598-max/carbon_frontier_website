(function () {
  "use strict";

  const LOCAL_PAGE_OVERRIDES_KEY = "carbon-frontier-wiki-local-pages-v3";
  const LEGACY_LOCAL_PAGE_OVERRIDES_KEYS = [
    "carbon-frontier-wiki-local-pages-v2",
    "carbon-frontier-wiki-local-pages-v1",
  ];
  const LOCAL_REDIRECTS_KEY = "carbon-frontier-wiki-local-redirects-v1";
  const LOCAL_TEMPLATES_KEY = "carbon-frontier-wiki-local-templates-v1";
  const PAGE_ENDPOINTS = ["/api/wiki/pages", "/.netlify/functions/wiki-pages"];
  const MEDIA_ENDPOINTS = ["/api/wiki/media", "/.netlify/functions/wiki-media"];
  const TEMPLATE_ENDPOINTS = ["/api/wiki/templates", "/.netlify/functions/wiki-templates"];
  const FONT_FAMILIES = new Map([
    ["play", "Play"],
    ["arial", "Arial"],
    ["georgia", "Georgia"],
    ["times new roman", "Times New Roman"],
    ["verdana", "Verdana"],
    ["courier new", "Courier New"],
  ]);
  const IMAGE_LAYOUTS = new Set([
    "inline",
    "wrap-left",
    "wrap-right",
    "break",
    "behind",
    "front",
  ]);
  const BLOCK_TYPES = new Set([
    "paragraph",
    "heading2",
    "heading3",
    "bullet-list",
    "numbered-list",
    "callout",
    "image",
    "template",
    "heading1", "heading4", "heading5", "heading6",
    "wiki-list", "table", "preformatted", "horizontal-rule", "comment",
  ]);
  const ALLOWED_INLINE_TAGS = new Set([
    "A",
    "B",
    "BR",
    "CODE",
    "EM",
    "FONT",
    "I",
    "S",
    "STRONG",
    "U",
    "SUB", "SUP",
  ]);

  const ui = {
    topTools: document.getElementById("wiki-topbar-tools"),
    modeVisual: document.getElementById("editor-mode-visual"),
    modeWikitext: document.getElementById("editor-mode-wikitext"),
    sourcePanel: document.getElementById("wikitext-panel"),
    source: document.getElementById("wikitext-input"),
    sourceStatus: document.getElementById("wikitext-status"),
    sourcePreview: document.getElementById("wikitext-preview"),
    sourcePreviewButton: document.getElementById("wikitext-preview-button"),
    sourceHelp: document.getElementById("wikitext-help"),
    sourceHelpButton: document.getElementById("wikitext-help-button"),
    topSearch: document.getElementById("wiki-top-search"),
    search: document.getElementById("wiki-search-input"),
    searchDialog: document.getElementById("wiki-search-dialog"),
    searchMenuInput: document.getElementById("wiki-search-menu-input"),
    searchResults: document.getElementById("wiki-search-results"),
    closeSearch: document.getElementById("close-search-button"),
    searchActions: document.getElementById("search-menu-actions"),
    browseAllPages: document.getElementById("browse-all-pages-button"),
    browseCategories: document.getElementById("browse-categories-button"),
    browseRedirects: document.getElementById("browse-redirects-button"),
    newPage: document.getElementById("new-page-button"),
    openTrash: document.getElementById("open-trash-button"),
    articleSurface: document.getElementById("article-surface"),
    breadcrumb: document.getElementById("article-breadcrumb"),
    title: document.getElementById("article-title"),
    titleInput: document.getElementById("editor-title-input"),
    meta: document.getElementById("article-meta"),
    content: document.getElementById("article-content"),
    categories: document.getElementById("article-categories"),
    editPage: document.getElementById("edit-page-button"),
    historyButton: document.getElementById("history-button"),
    feedback: document.getElementById("wiki-feedback"),
    documentToolbar: document.getElementById("document-toolbar"),
    undo: document.getElementById("toolbar-undo"),
    redo: document.getElementById("toolbar-redo"),
    blockStyle: document.getElementById("toolbar-block-style"),
    fontFamily: document.getElementById("toolbar-font-family"),
    bold: document.getElementById("toolbar-bold"),
    italic: document.getElementById("toolbar-italic"),
    underline: document.getElementById("toolbar-underline"),
    link: document.getElementById("toolbar-link"),
    bullets: document.getElementById("toolbar-bullets"),
    numbers: document.getElementById("toolbar-numbers"),
    image: document.getElementById("toolbar-image"),
    template: document.getElementById("toolbar-template"),
    imageOptions: document.getElementById("toolbar-image-options"),
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
    mediaDialogTitle: document.getElementById("media-dialog-title"),
    mediaForm: document.getElementById("media-form"),
    mediaCatalogSearch: document.getElementById("media-catalog-search"),
    mediaCatalogGrid: document.getElementById("media-catalog-grid"),
    mediaAlt: document.getElementById("media-alt-input"),
    mediaAltField: document.getElementById("media-alt-field"),
    mediaCaption: document.getElementById("media-caption-input"),
    mediaCaptionField: document.getElementById("media-caption-field"),
    mediaPreview: document.getElementById("media-preview"),
    mediaFeedback: document.getElementById("media-feedback"),
    uploadMedia: document.getElementById("upload-media-button"),
    closeMedia: document.getElementById("close-media-button"),
    cancelMedia: document.getElementById("cancel-media-button"),
    imageOptionsDialog: document.getElementById("image-options-dialog"),
    imageOptionsTitle: document.getElementById("image-options-title"),
    imageOptionsForm: document.getElementById("image-options-form"),
    imageLayoutGrid: document.getElementById("image-layout-grid"),
    imageWidth: document.getElementById("image-width-input"),
    imageWidthOutput: document.getElementById("image-width-output"),
    imageWidthLabel: document.getElementById("image-width-label"),
    imageAltField: document.getElementById("image-options-alt-field"),
    imageCaptionField: document.getElementById("image-options-caption-field"),
    imageAlt: document.getElementById("image-alt-input"),
    imageCaption: document.getElementById("image-caption-input"),
    imageDragNote: document.getElementById("image-drag-note"),
    imageOptionsFeedback: document.getElementById("image-options-feedback"),
    closeImageOptions: document.getElementById("close-image-options-button"),
    cancelImageOptions: document.getElementById("cancel-image-options-button"),
    removeImage: document.getElementById("remove-image-button"),
    templateDialog: document.getElementById("template-dialog"),
    templateForm: document.getElementById("template-form"),
    templateList: document.getElementById("template-picker-list"),
    templateValues: document.getElementById("template-value-fields"),
    templateFeedback: document.getElementById("template-picker-feedback"),
    closeTemplate: document.getElementById("close-template-button"),
    cancelTemplate: document.getElementById("cancel-template-button"),
    insertTemplate: document.getElementById("insert-template-button"),
    templateStudio: document.getElementById("open-template-studio-link"),
    managementDialog: document.getElementById("page-management-dialog"),
    managementTitle: document.getElementById("page-management-title"),
    managementNormalEdits: document.getElementById("management-normal-edits-input"),
    managementCategories: document.getElementById("page-categories-input"),
    saveCategories: document.getElementById("save-page-categories-button"),
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
    searchMode: "recent",
    selectedCategory: "",
    redirects: [],
    pageListPermissions: {},
    trashArmedSlug: "",
    media: [],
    selectedMediaId: "",
    mediaSearchTimer: 0,
    mediaObjectUrls: new Map(),
    mediaTargetInput: null,
    mediaTargetDisplay: null,
    mediaTargetButton: null,
    selectedFigure: null,
    selectedObject: null,
    selectedImageLayout: "inline",
    draggingFigure: null,
    draggingObject: null,
    layeredDrag: null,
    objectResize: null,
    templates: [],
    selectedTemplateId: "",
    editingTemplateNode: null,
    templateRemoteEndpoint: "",
    templateLoadPromise: null,
    editorMode: "visual",
    sourceContent: null,
    sourceReferences: {},
    visualSignature: "",
    switchingMode: false,
  };

  const wikitext = window.CarbonFrontierWikitext;
  const templateWikitext = window.CarbonFrontierTemplateWikitext;
  const mediaClient = window.CarbonFrontierWikiMedia.create({
    testing: Boolean(window.CarbonFrontierWikiCore?.isTestingEnvironment?.()),
    fetcher: (endpoint, options) => window.CarbonFrontierWikiCore.fetchWithAuth(endpoint, options),
  });

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

  function fetchProtectedMedia(mediaId) {
    return mediaClient.getBlob(mediaId);
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
      categories: [],
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
      categories: Array.isArray(page.categories) ? page.categories : [],
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
      categories: Array.isArray(page.categories) ? clone(page.categories) : [],
    };
  }

  async function listPages() {
    if (isTesting()) {
      return {
        ok: true,
        permissions: { canCreate: true, isAssignedStaff: true, canManageTrash: true },
        pages: testingPages().map(pageSummary),
        redirects: Object.entries(testingRedirects()).map(([sourceSlug, targetSlug]) => ({
          sourceSlug,
          targetSlug,
          targetTitle: testingPages().find((page) => page.slug === targetSlug)?.title || targetSlug,
        })),
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
      categories: [],
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
    } else if (body.action === "update_page_categories") {
      const unique = new Map();
      (Array.isArray(body.categories) ? body.categories : []).forEach((value) => {
        const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
        const categorySlug = slugify(name).slice(0, 80);
        if (name && categorySlug && !unique.has(categorySlug)) {
          unique.set(categorySlug, { id: `local-category-${categorySlug}`, slug: categorySlug, name });
        }
      });
      page.categories = [...unique.values()].slice(0, 20);
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
        const fontFace = child.tagName === "FONT"
          ? FONT_FAMILIES.get(String(child.getAttribute("face") || "").trim().toLowerCase()) || ""
          : "";
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
        if (child.tagName === "FONT" && fontFace) {
          child.setAttribute("face", fontFace);
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
      imageElement.loading = "lazy";
      imageElement.decoding = "async";
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

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function normalizeImageLayout(value, fallback = "wrap-right") {
    return IMAGE_LAYOUTS.has(value) ? value : fallback;
  }

  function configureFigure(figure, block = {}) {
    let layout = normalizeImageLayout(block.layout || figure.dataset.imageLayout);
    let width = clampNumber(block.widthPercent ?? figure.dataset.imageWidth, 20, 100, 46);
    if (block.id && !block.placementVersion && layout === "inline" && width === 72) {
      layout = "wrap-right";
      width = 46;
    }
    const x = clampNumber(block.xPercent ?? figure.dataset.imageX, 0, 85, 0);
    const y = clampNumber(block.yPixels ?? figure.dataset.imageY, 0, 5000, 0);
    figure.classList.add("wiki-placed-object", "wiki-image-object");
    figure.dataset.objectKind = "image";
    figure.dataset.objectLayout = layout;
    figure.dataset.objectWidth = String(width);
    figure.dataset.objectX = String(x);
    figure.dataset.objectY = String(y);
    figure.dataset.imageLayout = layout;
    figure.dataset.imageWidth = String(width);
    figure.dataset.imageX = String(x);
    figure.dataset.imageY = String(y);
    figure.style.setProperty("--wiki-object-width", `${width}%`);
    figure.style.setProperty("--wiki-object-x", String(x));
    figure.style.setProperty("--wiki-object-y", String(y));
    figure.draggable = Boolean(app.editing && !["behind", "front"].includes(layout));
    figure.tabIndex = app.editing ? 0 : -1;
    figure.setAttribute("role", "group");
    figure.setAttribute("aria-label", "Wiki image. Click to select; drag to move.");
  }

  function configureTemplateInstance(instance, block = {}) {
    if (block.layout !== undefined || block.widthPercent !== undefined) {
      instance.dataset.objectPlacementExplicit = "1";
    } else if (instance.dataset.objectPlacementExplicit === undefined) {
      instance.dataset.objectPlacementExplicit = "0";
    }
    const layout = normalizeImageLayout(block.layout || instance.dataset.templateLayout);
    const width = clampNumber(block.widthPercent ?? instance.dataset.templateWidth, 20, 100, 46);
    const x = clampNumber(block.xPercent ?? instance.dataset.templateX, 0, 85, 0);
    const y = clampNumber(block.yPixels ?? instance.dataset.templateY, 0, 5000, 0);
    instance.classList.add("wiki-placed-object");
    instance.dataset.objectKind = "template";
    instance.dataset.objectLayout = layout;
    instance.dataset.objectWidth = String(width);
    instance.dataset.objectX = String(x);
    instance.dataset.objectY = String(y);
    instance.dataset.templateLayout = layout;
    instance.dataset.templateWidth = String(width);
    instance.dataset.templateX = String(x);
    instance.dataset.templateY = String(y);
    instance.style.setProperty("--wiki-object-width", `${width}%`);
    instance.style.setProperty("--wiki-object-x", String(x));
    instance.style.setProperty("--wiki-object-y", String(y));
    instance.draggable = Boolean(app.editing && !["behind", "front"].includes(layout));
    instance.tabIndex = app.editing ? 0 : -1;
    instance.setAttribute("role", "group");
    instance.setAttribute("aria-label", "Wiki template. Click to select; drag to move; double-click to edit values.");
  }

  function isPlacedObject(node) {
    return Boolean(node?.classList?.contains("wiki-placed-object") && node.parentElement === ui.content);
  }

  function objectLayout(node) {
    return normalizeImageLayout(node?.dataset?.objectLayout);
  }

  function objectWidth(node) {
    return clampNumber(node?.dataset?.objectWidth, 20, 100, 46);
  }

  function configurePlacedObject(node, block = {}) {
    if (node?.dataset?.objectKind === "template" || node?.classList?.contains("wiki-template-instance")) {
      configureTemplateInstance(node, block);
    } else {
      configureFigure(node, block);
    }
  }

  function templateEndpoint(base, id = "") {
    if (!id) return base;
    return base.startsWith("/api/")
      ? `${base}/${encodeURIComponent(id)}`
      : `${base}?id=${encodeURIComponent(id)}`;
  }

  async function remoteTemplateRequest(id = "") {
    let lastError = new Error("The wiki template service is unavailable.");
    const bases = app.templateRemoteEndpoint
      ? [app.templateRemoteEndpoint, ...TEMPLATE_ENDPOINTS.filter((item) => item !== app.templateRemoteEndpoint)]
      : TEMPLATE_ENDPOINTS;
    for (const base of bases) {
      try {
        const response = await core().fetchWithAuth(templateEndpoint(base, id));
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && base.startsWith("/api/") && !id) {
          lastError = new Error(payload?.error || "The wiki template Function was not found.");
          continue;
        }
        if (!response.ok) {
          const error = new Error(payload?.error || `Template request failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        app.templateRemoteEndpoint = base;
        return payload;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status !== 404) throw error;
      }
    }
    throw lastError;
  }

  function localTemplates() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_TEMPLATES_KEY) || "null");
      const live = window.CarbonFrontierTestingSync?.getSection("wiki")?.templates;
      const base = Array.isArray(live) && live.length ? live : [{
        id: "template-machine-infobox",
        slug: "machine-infobox",
        name: "Machine Infobox",
        description: "A reusable information card for Carbon Frontier machines.",
        currentRevision: {
          id: "template-machine-infobox-revision-1",
          number: 1,
          definition: {
            version: 1,
            canvas: { width: 420, height: 560, backgroundColor: "#0b0b0b" },
            elements: [
              { id: "frame", type: "frame", x: 8, y: 8, width: 404, height: 544, zIndex: 1, fill: "#111111", stroke: "#df2531", strokeWidth: 3, borderRadius: 22, opacity: 1 },
              { id: "header", type: "shape", shape: "rectangle", x: 8, y: 8, width: 404, height: 88, zIndex: 2, fill: "#8f1922", stroke: "#df2531", strokeWidth: 0, borderRadius: 20, opacity: 1 },
              { id: "name", type: "placeholder", placeholderKey: "machine_name", defaultValue: "Machine Name", x: 30, y: 29, width: 360, height: 48, zIndex: 3, fontFamily: "Play", fontSize: 30, fontWeight: 700, textAlign: "left", color: "#ffffff", opacity: 1 },
              { id: "tier-label", type: "text", text: "TIER", x: 30, y: 126, width: 120, height: 24, zIndex: 3, fontFamily: "Play", fontSize: 13, fontWeight: 700, textAlign: "left", color: "#ff9ba2", opacity: 1 },
              { id: "tier", type: "placeholder", placeholderKey: "tier", defaultValue: "Tier 1", x: 30, y: 154, width: 360, height: 35, zIndex: 3, fontFamily: "Play", fontSize: 22, fontWeight: 400, textAlign: "left", color: "#ffffff", opacity: 1 },
              { id: "category-label", type: "text", text: "CATEGORY", x: 30, y: 214, width: 160, height: 24, zIndex: 3, fontFamily: "Play", fontSize: 13, fontWeight: 700, textAlign: "left", color: "#ff9ba2", opacity: 1 },
              { id: "category", type: "placeholder", placeholderKey: "category", defaultValue: "Processing", x: 30, y: 242, width: 360, height: 35, zIndex: 3, fontFamily: "Play", fontSize: 22, fontWeight: 400, textAlign: "left", color: "#ffffff", opacity: 1 },
              { id: "description-label", type: "text", text: "DESCRIPTION", x: 30, y: 310, width: 180, height: 24, zIndex: 3, fontFamily: "Play", fontSize: 13, fontWeight: 700, textAlign: "left", color: "#ff9ba2", opacity: 1 },
              { id: "description", type: "placeholder", placeholderKey: "description", defaultValue: "Describe what this machine does.", x: 30, y: 342, width: 360, height: 150, zIndex: 3, fontFamily: "Play", fontSize: 18, fontWeight: 400, textAlign: "left", color: "#e6e6e6", opacity: 1 },
            ],
          },
        },
        placeholders: [
          { key: "machine_name", label: "Machine Name", defaultValue: "Machine Name" },
          { key: "tier", label: "Tier", defaultValue: "Tier 1" },
          { key: "category", label: "Category", defaultValue: "Processing" },
          { key: "description", label: "Description", defaultValue: "Describe what this machine does." },
        ],
      }];
      if (!Array.isArray(saved)) return clone(base);
      const overrides = new Map(saved.map((template) => [template.id, template]));
      const merged = base.map((template) => overrides.get(template.id) || template);
      saved.forEach((template) => {
        if (!merged.some((current) => current.id === template.id)) merged.push(template);
      });
      return clone(merged.filter((template) => !template.isDeleted));
    } catch (error) {
      return [];
    }
  }

  async function loadTemplates({ force = false } = {}) {
    if (app.templates.length && !force) return app.templates;
    if (app.templateLoadPromise && !force) return app.templateLoadPromise;
    app.templateLoadPromise = (async () => {
      if (isTesting()) app.templates = localTemplates();
      else {
        const payload = await remoteTemplateRequest();
        app.templates = Array.isArray(payload.templates) ? payload.templates : [];
      }
      return app.templates;
    })();
    try {
      return await app.templateLoadPromise;
    } finally {
      app.templateLoadPromise = null;
    }
  }

  async function loadTemplate(id) {
    if (!app.templates.length) await loadTemplates();
    const local = app.templates.find((template) => template.id === id || template.slug === id);
    if (isTesting() || local) return local || null;
    try {
      const payload = await remoteTemplateRequest(id);
      if (payload?.template) {
        const index = app.templates.findIndex((template) => template.id === payload.template.id);
        if (index >= 0) app.templates[index] = payload.template;
        else app.templates.push(payload.template);
      }
      return payload?.template || local || null;
    } catch (error) {
      return local || null;
    }
  }

  function safeTemplateColor(value, fallback = "transparent") {
    const color = String(value || "").trim();
    return color === "transparent" || /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  function drawTemplateObject(raw, values) {
    const element = raw && typeof raw === "object" ? raw : {};
    const node = document.createElement("div");
    const type = ["text", "placeholder", "image-placeholder", "shape", "frame", "line", "image"].includes(element.type)
      ? element.type
      : "shape";
    node.className = `wiki-template-object${["text", "placeholder"].includes(type) ? " is-text" : ""}${["shape", "frame"].includes(type) ? " is-shape" : ""}${type === "line" ? " is-line" : ""}${type === "image-placeholder" ? " is-image-placeholder" : ""}`;
    Object.assign(node.style, {
      left: `${clampNumber(element.x, -1600, 3200, 0)}px`,
      top: `${clampNumber(element.y, -1600, 3200, 0)}px`,
      width: `${clampNumber(element.width, 2, 3200, 20)}px`,
      height: type === "line" ? "0" : `${clampNumber(element.height, 2, 3200, 20)}px`,
      zIndex: String(Math.round(clampNumber(element.zIndex, -1000, 1000, 1))),
    });
    node.style.setProperty("--object-rotation", `${clampNumber(element.rotation, -360, 360, 0)}deg`);
    node.style.setProperty("--object-opacity", String(clampNumber(element.opacity, 0.05, 1, 1)));
    if (type === "text" || type === "placeholder") {
      const key = String(element.placeholderKey || "");
      node.textContent = type === "placeholder"
        ? String(values?.[key] ?? element.defaultValue ?? `{{${key}}}`).slice(0, 1000)
        : String(element.text || "").slice(0, 1000);
      Object.assign(node.style, {
        fontFamily: FONT_FAMILIES.has(String(element.fontFamily || "").toLowerCase())
          ? FONT_FAMILIES.get(String(element.fontFamily).toLowerCase())
          : "Play",
        fontSize: `${clampNumber(element.fontSize, 8, 144, 24)}px`,
        fontWeight: Number(element.fontWeight) >= 700 ? "700" : "400",
        fontStyle: element.fontStyle === "italic" ? "italic" : "normal",
        textAlign: ["left", "center", "right"].includes(element.textAlign) ? element.textAlign : "left",
        color: safeTemplateColor(element.color, "#ffffff"),
      });
    } else if (type === "line") {
      node.style.borderTopColor = safeTemplateColor(element.stroke, "#ffffff");
      node.style.borderTopWidth = `${clampNumber(element.strokeWidth, 1, 24, 3)}px`;
    } else if (type === "image") {
      const image = document.createElement("img");
      image.alt = String(element.alt || "Template image").slice(0, 240);
      image.style.objectFit = element.fit === "contain" ? "contain" : "cover";
      image.style.borderRadius = `${clampNumber(element.borderRadius, 0, 200, 0)}px`;
      const url = String(element.url || "");
      if (/^(?:data:image\/|blob:|https:\/\/)/i.test(url)) image.src = url;
      else if (element.mediaId) image.dataset.wikiMediaId = String(element.mediaId);
      node.append(image);
    } else if (type === "image-placeholder") {
      const key = String(element.placeholderKey || "");
      const mediaId = String(values?.[key] || "").trim();
      node.style.background = safeTemplateColor(element.fill, "#1b1b1e");
      node.style.borderColor = safeTemplateColor(element.stroke, "#df2531");
      node.style.borderWidth = `${clampNumber(element.strokeWidth, 0, 24, 2)}px`;
      node.style.borderRadius = `${clampNumber(element.borderRadius, 0, 200, 18)}px`;
      if (mediaId) {
        const image = document.createElement("img");
        if (/^(?:data:image\/|blob:|https:\/\/)/i.test(mediaId)) image.src = mediaId;
        else image.dataset.wikiMediaId = mediaId;
        image.alt = String(element.defaultAlt || "Template image").slice(0, 240);
        image.style.objectFit = element.fit === "contain" ? "contain" : "cover";
        node.append(image);
      } else {
        const empty = document.createElement("span");
        empty.textContent = `Choose image · ${key || "image"}`;
        node.append(empty);
      }
    } else {
      node.dataset.shape = type === "frame" ? "rounded" : String(element.shape || "rectangle");
      node.style.background = safeTemplateColor(element.fill, type === "frame" ? "transparent" : "#df2531");
      node.style.borderColor = safeTemplateColor(element.stroke, "#ffffff");
      node.style.borderWidth = `${clampNumber(element.strokeWidth, 0, 24, type === "frame" ? 3 : 1)}px`;
      node.style.borderRadius = `${clampNumber(element.borderRadius, 0, 200, type === "frame" ? 16 : 0)}px`;
    }
    return node;
  }

  async function hydrateWikitextTemplateMedia(container) {
    const images = [...container.querySelectorAll("img[data-wiki-file-title]")];
    if (!images.length) return;
    if (!app.media.length) {
      try { app.media = (await mediaClient.list({ sort: "newest", limit: 500 })).media || []; }
      catch (error) { /* Missing catalog items stay as labeled image placeholders. */ }
    }
    const normalized = (value) => String(value || "").trim().replace(/^File:/i, "").replaceAll("_", " ").toLowerCase();
    images.forEach((image) => {
      const wanted = normalized(image.dataset.wikiFileTitle);
      const media = app.media.find((item) => item.id === image.dataset.wikiFileTitle ||
        [item.title, item.originalName].some((name) => normalized(name) === wanted));
      if (media) image.dataset.wikiMediaId = media.id;
      else {
        image.hidden = true;
        const missing = document.createElement("span");
        missing.className = "cf-template-missing";
        missing.textContent = `Missing image: ${image.dataset.wikiFileTitle}`;
        image.after(missing);
      }
    });
    await hydrateMediaImages(container);
  }

  function renderTemplateInto(instance, template, values, fallbackDefinition = null) {
    const definition = template?.currentRevision?.definition || fallbackDefinition;
    if (!definition?.canvas) {
      instance.textContent = "This template is unavailable.";
      return;
    }
    if (definition.kind === "wikitext" && definition.source && templateWikitext?.render) {
      instance.__templateResizeObserver?.disconnect?.();
      instance.style.setProperty("--template-width", "100%");
      instance.style.height = "";
      instance.dataset.templateRevisionId = template?.currentRevision?.id || instance.dataset.templateRevisionId || "";
      const rendered = document.createElement("div");
      rendered.className = "wiki-template-wikitext";
      try {
        rendered.innerHTML = templateWikitext.render(definition.source, values, { templates: app.templates, pages: app.pages }).html;
      } catch (error) {
        rendered.className += " cf-template-error";
        rendered.textContent = error.message || "This template source could not be rendered.";
      }
      instance.replaceChildren(rendered);
      if (app.selectedObject === instance) addResizeHandles(instance);
      hydrateWikitextTemplateMedia(rendered);
      return;
    }
    const width = Math.round(clampNumber(definition.canvas.width, 240, 1600, 720));
    const height = Math.round(clampNumber(definition.canvas.height, 120, 1600, 420));
    instance.style.setProperty("--template-width", `${width}px`);
    instance.dataset.templateRevisionId = template?.currentRevision?.id || instance.dataset.templateRevisionId || "";
    const stage = document.createElement("div");
    stage.className = "wiki-template-stage";
    stage.style.setProperty("--template-width", `${width}px`);
    stage.style.setProperty("--template-height", `${height}px`);
    stage.style.background = safeTemplateColor(definition.canvas.backgroundColor, "#111111");
    stage.replaceChildren(...(Array.isArray(definition.elements) ? definition.elements : []).map((element) => drawTemplateObject(element, values)));
    instance.replaceChildren(stage);
    if (app.selectedObject === instance) addResizeHandles(instance);
    const size = () => {
      const available = instance.clientWidth || width;
      const scale = Math.min(1, available / width);
      instance.style.setProperty("--template-scale", String(scale));
      instance.style.height = `${Math.ceil(height * scale)}px`;
    };
    size();
    window.requestAnimationFrame(() => {
      if (!instance.isConnected) return;
      size();
      if (window.ResizeObserver) {
        instance.__templateResizeObserver?.disconnect?.();
        instance.__templateResizeObserver = new ResizeObserver(size);
        instance.__templateResizeObserver.observe(instance);
      }
    });
    hydrateMediaImages(instance);
  }

  function createTemplateInstance(block, live = true) {
    const instance = document.createElement("div");
    instance.className = "wiki-template-instance";
    instance.contentEditable = "false";
    instance.dataset.wikiTemplateId = String(block.templateId || "");
    instance.dataset.wikiTemplateSlug = String(block.templateSlug || "");
    instance.__wikiTemplateBlock = clone(block);
    instance.dataset.templateBlock = JSON.stringify(block);
    configureTemplateInstance(instance, block);
    renderTemplateInto(instance, null, block.values || {}, block.snapshot || null);
    if (live) loadTemplate(block.templateId || block.templateSlug).then((template) => {
      if (!template || !instance.isConnected) return;
      renderTemplateInto(instance, template, instance.__wikiTemplateBlock.values || {}, block.snapshot || null);
    }).catch(() => { /* The saved snapshot remains readable when templates cannot be fetched. */ });
    return instance;
  }

  function drawWikiList(entries) {
    const root = document.createElement("div"); root.className = "wiki-nested-list";
    let stack = [];
    for (const entry of (entries || []).slice(0,2000)) {
      const path = String(entry.path || "*").replace(/[^*#]/g, "").slice(0,12) || "*";
      let common = 0;
      while (common < stack.length && common < path.length && stack[common].kind === path[common]) common++;
      stack = stack.slice(0,common);
      for (let depth = common; depth < path.length; depth++) {
        const list = document.createElement(path[depth] === "#" ? "ol" : "ul");
        if (!depth) root.append(list);
        else {
          const parent = stack[depth-1];
          if (!parent.last) { parent.last = document.createElement("li"); parent.list.append(parent.last); }
          parent.last.append(list);
        }
        stack.push({kind:path[depth],list,last:null});
      }
      const item = document.createElement("li"); setInlineContent(item,entry);
      stack[stack.length-1].list.append(item); stack[stack.length-1].last=item;
    }
    return root;
  }

  function drawWikiTable(block) {
    const table = document.createElement("table");
    if (block.caption?.html || block.caption?.text) { const caption = document.createElement("caption"); setInlineContent(caption,block.caption); table.append(caption); }
    const body = document.createElement("tbody");
    (block.rows || []).slice(0,200).forEach(row => {
      const tr = document.createElement("tr");
      row.slice(0,30).forEach(cell => {
        const td = document.createElement(cell.header ? "th" : "td");
        td.colSpan = Math.round(clampNumber(cell.colspan,1,20,1)); td.rowSpan = Math.round(clampNumber(cell.rowspan,1,20,1));
        setInlineContent(td,cell); tr.append(td);
      }); body.append(tr);
    }); table.append(body); return table;
  }

  function renderContent(container, content, { liveTemplates = true } = {}) {
    container.querySelectorAll(".wiki-template-instance").forEach(node => node.__templateResizeObserver?.disconnect());
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
      const type = BLOCK_TYPES.has(block?.type) ? block.type : "preserved";
      let element;
      if (type === "template") {
        element = createTemplateInstance(block, liveTemplates);
      } else if (type === "table") {
        element = drawWikiTable(block);
      } else if (type === "wiki-list") {
        element = drawWikiList(block.entries);
      } else if (type === "preformatted") {
        element = document.createElement("pre"); element.textContent = block.text || "";
      } else if (type === "horizontal-rule") {
        element = document.createElement("hr");
      } else if (type === "comment" || type === "preserved") {
        element = document.createElement("div"); element.contentEditable = "false";
        element.className = type === "comment" ? "wiki-source-comment" : "wiki-source-preserved";
        element.dataset.preservedBlock = JSON.stringify(block);
        element.textContent = type === "comment" ? "Source comment: " + (block.text || "") : (block.text || "Visual block — preserved in wikitext mode.");
      } else if (type === "image") {
        element = document.createElement("figure");
        element.contentEditable = "false";
        element.dataset.wikiMediaId = String(block.mediaId || "");
        element.dataset.wikiMediaUrl = String(block.url || "");
        configureFigure(element, block);
        const image = document.createElement("img");
        image.loading = "lazy";
        image.decoding = "async";
        image.alt = String(block.alt || "").slice(0, 240);
        image.dataset.wikiMediaId = String(block.mediaId || "");
        const directUrl = String(block.url || "");
        if (/^(?:data:image\/|blob:|https:\/\/)/i.test(directUrl)) {
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
      } else if (/^heading[1-6]$/.test(type)) {
        element = document.createElement("h" + type.slice(-1));
        setInlineContent(element, block);
        element.id = wikitext.slugify(element.textContent);
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
      if (block.id) element.dataset.blockId = block.id;
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

  function serializeWikiList(root) {
    const entries=[];
    function walk(list,path) {
      for (const item of list.children) {
        if (item.tagName !== "LI") continue;
        const own = item.cloneNode(true);
        own.querySelectorAll("ul,ol").forEach(child => child.remove());
        entries.push({path,...serializeInlineElement(own)});
        [...item.children].filter(child=>["UL","OL"].includes(child.tagName)).forEach(child=>walk(child,path+(child.tagName === "UL" ? "*" : "#")));
      }
    }
    if (["UL","OL"].includes(root.tagName)) walk(root,root.tagName === "UL" ? "*" : "#");
    else [...root.children].filter(child=>["UL","OL"].includes(child.tagName)).forEach(child=>walk(child,child.tagName === "UL" ? "*" : "#"));
    return entries;
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
      const blockId = node.dataset.blockId || (node.dataset.blockId = randomId("block"));
      if (node.dataset.preservedBlock) {
        blocks.push({...JSON.parse(node.dataset.preservedBlock),id:blockId});
        return;
      }
      if (node.classList.contains("wiki-template-instance")) {
        const saved = node.__wikiTemplateBlock || JSON.parse(node.dataset.templateBlock || "null");
        if (!saved) throw new Error("This template could not be read. Reinsert it before saving.");
        const templateBlock = {
          ...clone(saved),
          id: blockId,
          type: "template",
        };
        if (node.dataset.objectPlacementExplicit === "1") Object.assign(templateBlock, {
          layout: objectLayout(node), widthPercent: objectWidth(node),
          xPercent: clampNumber(node.dataset.objectX, 0, 85, 0), yPixels: clampNumber(node.dataset.objectY, 0, 5000, 0),
        });
        blocks.push(templateBlock);
        return;
      }
      if (tag === "TABLE") {
        blocks.push({id:blockId,type:"table",caption:node.caption ? serializeInlineElement(node.caption) : {text:"",html:""},
          rows:[...node.rows].map(row=>[...row.cells].map(cell=>({header:cell.tagName === "TH",colspan:cell.colSpan,rowspan:cell.rowSpan,...serializeInlineElement(cell)})))});
        return;
      }
      if (tag === "PRE" || tag === "HR") {
        blocks.push({id:blockId,type:tag === "PRE" ? "preformatted" : "horizontal-rule",...(tag === "PRE" ? {text:node.textContent} : {})});
        return;
      }
      if (node.classList.contains("wiki-nested-list") || ((tag === "UL" || tag === "OL") && node.querySelector("li ul,li ol"))) {
        blocks.push({id:blockId,type:"wiki-list",entries:serializeWikiList(node)});
        return;
      }
      if (tag === "FIGURE" && (node.dataset.wikiMediaId || node.dataset.wikiMediaUrl)) {
        const image = node.querySelector("img");
        const caption = node.querySelector("figcaption");
        blocks.push({
          id: blockId,
          type: "image",
          mediaId: node.dataset.wikiMediaId,
          url: node.dataset.wikiMediaUrl || "",
          alt: String(image?.alt || "").slice(0, 240),
          caption: String(caption?.textContent || "").trim().slice(0, 300),
          layout: objectLayout(node),
          widthPercent: objectWidth(node),
          xPercent: clampNumber(node.dataset.imageX, 0, 85, 0),
          yPixels: clampNumber(node.dataset.imageY, 0, 5000, 0),
        });
        return;
      }
      if (tag === "UL" || tag === "OL") {
        blocks.push({
          id: blockId,
          type: tag === "UL" ? "bullet-list" : "numbered-list",
          items: [...node.querySelectorAll(":scope > li")].map((item) => serializeInlineElement(item)),
        });
        return;
      }
      const type = /^H[1-6]$/.test(tag)
        ? "heading" + tag.slice(-1)
          : tag === "BLOCKQUOTE" || node.classList.contains("article-callout")
            ? "callout"
            : "paragraph";
      blocks.push({
        id: blockId,
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
    renderContent(temporary, content, {liveTemplates:false});
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
    const summary = String(ui.content.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 155) || `Read ${page.title} on the Carbon Frontier Wiki.`;
    const description = document.querySelector('meta[name="description"]');
    const openGraphTitle = document.querySelector('meta[property="og:title"]');
    const openGraphDescription = document.querySelector('meta[property="og:description"]');
    const canonical = document.querySelector('link[rel="canonical"]');
    if (description) description.content = summary;
    if (openGraphTitle) openGraphTitle.content = `${page.title} | Carbon Frontier Wiki`;
    if (openGraphDescription) openGraphDescription.content = summary;
    if (canonical) canonical.href = `wiki.html?page=${encodeURIComponent(page.slug)}`;
  }

  function categoryDirectory() {
    const categories = new Map();
    app.pages.forEach((page) => (page.categories || []).forEach((category) => {
      if (!categories.has(category.slug)) categories.set(category.slug, { ...category, pages: [] });
      categories.get(category.slug).pages.push(page);
    }));
    return [...categories.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function appendSearchResult({ icon, title, meta, hint, slug = "", categorySlug = "" }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `wiki-search-result${slug === app.currentSlug ? " is-active" : ""}`;
    if (slug) button.dataset.slug = slug;
    if (categorySlug) button.dataset.categorySlug = categorySlug;
    const mark = document.createElement("span");
    mark.className = "search-result-icon";
    mark.textContent = icon;
    const copy = document.createElement("span");
    copy.className = "search-result-copy";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = meta;
    copy.append(heading, detail);
    const openHint = document.createElement("small");
    openHint.textContent = hint;
    button.append(mark, copy, openHint);
    ui.searchResults.append(button);
  }

  function updateSearchModeButtons() {
    ui.browseAllPages.setAttribute("aria-pressed", String(app.searchMode === "all"));
    ui.browseCategories.setAttribute("aria-pressed", String(app.searchMode === "categories"));
    ui.browseRedirects.setAttribute("aria-pressed", String(app.searchMode === "redirects"));
  }

  function renderSearchResults() {
    const rawQuery = ui.searchMenuInput.value.trim();
    const query = rawQuery.toLowerCase();
    ui.searchResults.replaceChildren();
    app.searchIndex = -1;
    updateSearchModeButtons();
    const label = document.createElement("p");
    label.className = "search-results-label";
    ui.searchResults.append(label);

    if (!query && app.searchMode === "categories" && !app.selectedCategory) {
      const categories = categoryDirectory();
      label.textContent = "Categories";
      if (!categories.length) {
        const empty = document.createElement("p");
        empty.className = "wiki-list-state";
        empty.textContent = "No pages have categories yet. Assigned staff can add them from Page Settings while editing.";
        ui.searchResults.append(empty);
        return;
      }
      categories.forEach((category) => appendSearchResult({
        icon: "#", title: category.name,
        meta: `${category.pages.length} page${category.pages.length === 1 ? "" : "s"}`,
        hint: "Browse →", categorySlug: category.slug,
      }));
      return;
    }

    if (!query && app.searchMode === "redirects") {
      label.textContent = "Redirects";
      if (!app.redirects.length) {
        const empty = document.createElement("p");
        empty.className = "wiki-list-state";
        empty.textContent = "No redirect addresses have been created yet.";
        ui.searchResults.append(empty);
        return;
      }
      app.redirects.forEach((redirect) => appendSearchResult({
        icon: "↪", title: redirect.sourceSlug,
        meta: `Redirects to ${redirect.targetTitle || redirect.targetSlug}`,
        hint: "Follow →", slug: redirect.sourceSlug,
      }));
      return;
    }

    let visiblePages = [...app.pages];
    if (query) {
      visiblePages = visiblePages.filter((page) => `${page.title} ${page.slug} ${(page.categories || []).map((category) => category.name).join(" ")}`
        .toLowerCase().includes(query));
      label.textContent = `Results for “${rawQuery}”`;
    } else if (app.searchMode === "categories" && app.selectedCategory) {
      const category = categoryDirectory().find((item) => item.slug === app.selectedCategory);
      visiblePages = category?.pages || [];
      label.textContent = category ? `${category.name} · ${visiblePages.length} page${visiblePages.length === 1 ? "" : "s"}` : "Category";
    } else if (app.searchMode === "all") {
      visiblePages.sort((left, right) => left.title.localeCompare(right.title));
      label.textContent = `All pages · ${visiblePages.length}`;
    } else {
      visiblePages.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
      visiblePages = visiblePages.slice(0, 12);
      label.textContent = "Recently updated";
    }

    if (!visiblePages.length) {
      const empty = document.createElement("p");
      empty.className = "wiki-list-state";
      empty.textContent = query ? "No wiki pages match that search." : "No wiki pages are in this section yet.";
      ui.searchResults.append(empty);
      return;
    }
    visiblePages.slice(0, query ? 40 : 250).forEach((page) => appendSearchResult({
      icon: "▤", title: page.title,
      meta: page.revisionNumber ? `Revision ${page.revisionNumber} · ${formatDate(page.updatedAt)}` : `Updated ${formatDate(page.updatedAt)}`,
      hint: page.slug === app.currentSlug ? "Current" : "Open →", slug: page.slug,
    }));
  }

  function openSearchMenu() {
    if (app.editing || ui.search.disabled) {
      return;
    }
    ui.searchMenuInput.value = "";
    app.searchMode = "recent";
    app.selectedCategory = "";
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

  function browseSearchMode(mode) {
    app.searchMode = mode;
    app.selectedCategory = "";
    ui.searchMenuInput.value = "";
    renderSearchResults();
    ui.searchMenuInput.focus({ preventScroll: true });
  }

  function renderPageCategories(page) {
    ui.categories.replaceChildren();
    const categories = Array.isArray(page.categories) ? page.categories : [];
    ui.categories.hidden = !categories.length;
    if (!categories.length) return;
    const label = document.createElement("span");
    label.className = "article-categories-label";
    label.textContent = "Categories";
    ui.categories.append(label);
    categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "category-chip";
      button.dataset.openCategory = category.slug;
      button.textContent = category.name;
      ui.categories.append(button);
    });
  }

  function renderPage(page) {
    app.currentPage = page;
    clearSelectedFigure();
    ui.breadcrumb.textContent = page.slug === "front-page" ? "Wiki front page" : "Wiki article";
    ui.title.textContent = page.title;
    const revision = page.currentRevision;
    const author = authorLabel(revision);
    ui.meta.textContent = revision
      ? `Revision ${revision.number} · ${formatDate(revision.createdAt)} · ${author}`
      : "No saved revision.";
    renderContent(ui.content, revision?.content);
    ui.articleSurface.setAttribute("aria-busy", "false");
    renderPageCategories(page);
    ui.editPage.hidden = !page.permissions?.canEdit;
    ui.historyButton.hidden = true;
    ui.pageSettings.hidden = true;
    updateDocumentTitle(page);
  }

  function renderPageError(error) {
    app.currentPage = null;
    clearSelectedFigure();
    ui.breadcrumb.textContent = "Wiki article";
    ui.title.textContent = error?.status === 404 ? "Page not found" : "Page unavailable";
    ui.meta.textContent = "";
    ui.editPage.hidden = true;
    ui.historyButton.hidden = true;
    ui.content.replaceChildren();
    ui.categories.replaceChildren();
    ui.categories.hidden = true;
    const message = document.createElement("p");
    message.className = "article-empty";
    message.textContent = error?.message || "This wiki page could not be loaded.";
    ui.content.append(message);
    ui.articleSurface.setAttribute("aria-busy", "false");
  }

  async function refreshPageList() {
    const payload = await listPages();
    app.pages = Array.isArray(payload.pages) ? payload.pages : [];
    app.redirects = Array.isArray(payload.redirects) ? payload.redirects : [];
    app.pageListPermissions = payload.permissions || {};
    ui.topTools.hidden = false;
    ui.newPage.hidden = !payload.permissions?.canCreate;
    ui.openTrash.hidden = !payload.permissions?.canManageTrash;
    ui.searchActions.hidden = false;
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
    ui.articleSurface.setAttribute("aria-busy", "true");
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

  function contentSignature(content) {
    return JSON.stringify(content?.blocks || [], (key,value) => key === "id" ? undefined : value);
  }

  function sourceContext() {
    return {preserved:app.sourceReferences, templates:app.templates, pages:app.pages};
  }

  function updateEditorMode() {
    const source = app.editing && app.editorMode === "wikitext";
    ui.modeVisual.setAttribute("aria-pressed", String(!source));
    ui.modeWikitext.setAttribute("aria-pressed", String(source));
    ui.sourcePanel.hidden = !source;
    ui.content.hidden = source;
    ui.content.contentEditable = String(app.editing && !source);
    [ui.undo,ui.redo,ui.blockStyle,ui.fontFamily,ui.bold,ui.italic,ui.underline,ui.link,ui.bullets,ui.numbers,ui.image,ui.template,ui.imageOptions].forEach(control=>{
      control.disabled = source;
    });
  }

  function readEditedContent() {
    const base = app.editingBasePage?.currentRevision?.content || {};
    if (app.editorMode === "wikitext") {
      // Keeping a conversion untouched must not remove visual-only fields.
      if (app.sourceContent && ui.source.value === app.sourceContent.wikitext?.source) return clone(app.sourceContent);
      return {...clone(base), ...wikitext.parse(ui.source.value,sourceContext())};
    }
    const visual = serializeEditorContent();
    if (app.sourceContent && contentSignature(visual) === app.visualSignature) return clone(app.sourceContent);
    const generated = wikitext.format(visual,sourceContext());
    return {...clone(base),...visual,version:3,wikitext:{version:1,source:generated.source}};
  }

  async function switchEditorMode(mode) {
    if (!app.editing || app.switchingMode || mode === app.editorMode) return;
    const editingPage = app.editingBasePage;
    app.switchingMode=true; ui.modeVisual.disabled=true; ui.modeWikitext.disabled=true; ui.savePage.disabled=true;
    try {
      if (mode === "wikitext") {
        try { await loadTemplates(); } catch { /* Plain wikitext and existing template snapshots still work. */ }
        if (!app.editing || app.editingBasePage !== editingPage) return;
        const visual = serializeEditorContent();
        const previous = app.sourceContent;
        const unchanged = previous && contentSignature(visual) === app.visualSignature;
        const generated = wikitext.format(unchanged ? previous : visual,sourceContext());
        app.sourceReferences=generated.preserved;
        const source = unchanged && previous.wikitext?.version === 1 ? previous.wikitext.source : generated.source;
        app.sourceContent={...(unchanged ? clone(previous) : {...clone(editingPage.currentRevision.content),...visual}),wikitext:{version:1,source}};
        app.visualSignature=contentSignature(visual);
        ui.source.value=source; ui.sourcePreview.hidden=true; ui.sourcePreviewButton.setAttribute("aria-expanded","false");
        ui.linkPopover.hidden=true; clearSelectedFigure();
        setFeedback(ui.sourceStatus,"Ready. Preview checks your markup before you save.");
      } else {
        const parsed=readEditedContent();
        renderContent(ui.content,parsed);
        app.sourceContent=clone(parsed);
        app.sourceReferences=wikitext.references(parsed);
        app.visualSignature=contentSignature(serializeEditorContent());
        app.savedSelection=null;
      }
      app.editorMode=mode; updateEditorMode();
      if (mode === "visual") {
        ui.content.querySelectorAll(".wiki-placed-object").forEach((object) => configurePlacedObject(object));
      }
      (mode === "wikitext" ? ui.source : ui.content).focus();
      setFeedback(ui.feedback,mode === "wikitext" ? "Wikitext mode. Preview or save when ready." : "Visual mode. Your source changes are ready to edit.");
    } catch(error) {
      setFeedback(ui.sourceStatus,error.message,true);
      setFeedback(ui.feedback,error.message,true);
      ui.source.focus();
    } finally {
      app.switchingMode=false; ui.modeVisual.disabled=false; ui.modeWikitext.disabled=false; ui.savePage.disabled=false;
    }
  }

  function previewWikitext() {
    try {
      const content=readEditedContent();
      renderContent(ui.sourcePreview,content);
      ui.sourcePreview.hidden=false; ui.sourcePreviewButton.setAttribute("aria-expanded","true");
      setFeedback(ui.sourceStatus,"Preview updated. These changes have not been saved yet.");
    } catch(error) {
      ui.sourcePreview.hidden=true; ui.sourcePreviewButton.setAttribute("aria-expanded","false");
      setFeedback(ui.sourceStatus,error.message,true);
    }
  }

  function enterEditing() {
    const page = app.currentPage;
    if (!page?.permissions?.canEdit || app.editing) {
      return;
    }
    app.editing = true;
    app.editingBasePage = clone(page);
    app.editorMode = "visual";
    app.sourceContent = clone(page.currentRevision?.content || {type:"document",version:2,blocks:[]});
    app.sourceReferences = wikitext.references(app.sourceContent);
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
    app.visualSignature = contentSignature(serializeEditorContent());
    updateEditorMode();
    [...ui.content.querySelectorAll(".wiki-placed-object")].forEach((object) => configurePlacedObject(object));
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
    app.editorMode = "visual";
    app.sourceContent = null;
    app.sourceReferences = {};
    app.visualSignature = "";
    updateEditorMode();
    ui.articleSurface.classList.remove("is-editing");
    ui.documentToolbar.hidden = true;
    ui.linkPopover.hidden = true;
    closeImageOptions();
    clearSelectedFigure();
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
    if (!app.editing || app.editorMode !== "visual") {
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
    if (!app.editing || app.editorMode !== "visual") {
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
    const activeFont = String(document.queryCommandValue("fontName") || "")
      .replace(/["']/g, "")
      .trim()
      .toLowerCase();
    ui.fontFamily.value = FONT_FAMILIES.get(activeFont) || "Play";
  }

  function removeResizeHandles(node) {
    node?.querySelectorAll(":scope > .object-resize-handle").forEach((handle) => handle.remove());
  }

  function addResizeHandles(node) {
    if (!app.editing || !isPlacedObject(node)) return;
    removeResizeHandles(node);
    ["nw", "ne", "sw", "se"].forEach((corner) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `object-resize-handle object-resize-${corner}`;
      handle.dataset.resizeCorner = corner;
      handle.contentEditable = "false";
      handle.setAttribute("aria-label", `Resize ${node.dataset.objectKind} from ${corner.toUpperCase()} corner`);
      node.append(handle);
    });
  }

  function clearSelectedFigure() {
    const selected = app.selectedObject || app.selectedFigure;
    if (selected?.isConnected) {
      selected.classList.remove("is-object-selected", "is-image-selected");
      removeResizeHandles(selected);
    }
    app.selectedObject = null;
    app.selectedFigure = null;
    if (ui.imageOptions) ui.imageOptions.hidden = true;
  }

  function selectFigure(object) {
    if (!app.editing || !isPlacedObject(object)) return;
    const previous = app.selectedObject || app.selectedFigure;
    if (previous && previous !== object) {
      previous.classList.remove("is-object-selected", "is-image-selected");
      removeResizeHandles(previous);
    }
    app.selectedObject = object;
    app.selectedFigure = object.dataset.objectKind === "image" ? object : null;
    object.classList.add("is-object-selected");
    if (object.dataset.objectKind === "image") object.classList.add("is-image-selected");
    if (!object.querySelector(":scope > .object-resize-handle")) addResizeHandles(object);
    ui.imageOptions.hidden = false;
    ui.imageOptions.textContent = "Layout Options";
    ui.imageOptions.title = `Change the selected ${object.dataset.objectKind}`;
  }

  function setImageLayoutChoice(layout) {
    app.selectedImageLayout = normalizeImageLayout(layout);
    [...ui.imageLayoutGrid.querySelectorAll("[data-image-layout]")].forEach((button) => {
      button.classList.toggle("is-active", button.dataset.imageLayout === app.selectedImageLayout);
      button.setAttribute("aria-pressed", String(button.dataset.imageLayout === app.selectedImageLayout));
    });
  }

  function openImageOptions() {
    const object = app.selectedObject;
    if (!app.editing || !object?.isConnected) {
      setFeedback(ui.feedback, "Click an image or template first, then choose Layout Options.", true);
      return;
    }
    const isTemplate = object.dataset.objectKind === "template";
    setImageLayoutChoice(objectLayout(object));
    ui.imageWidth.value = String(objectWidth(object));
    ui.imageWidthOutput.textContent = `${ui.imageWidth.value}%`;
    ui.imageOptionsTitle.textContent = isTemplate ? "Template layout" : "Image layout";
    ui.imageWidthLabel.textContent = isTemplate ? "Template width" : "Image width";
    ui.imageAltField.hidden = isTemplate;
    ui.imageCaptionField.hidden = isTemplate;
    ui.imageAlt.disabled = isTemplate;
    ui.imageCaption.disabled = isTemplate;
    ui.imageAlt.required = !isTemplate;
    ui.removeImage.textContent = isTemplate ? "Remove Template" : "Remove Image";
    ui.imageDragNote.textContent = `Drag this ${isTemplate ? "template" : "image"} to move it between paragraphs. Wrapped objects sit beside text; layered objects can move freely across the page. Use the corner handles for quick resizing.`;
    if (!isTemplate) {
      ui.imageAlt.value = String(object.querySelector("img")?.alt || "");
      ui.imageCaption.value = String(object.querySelector("figcaption")?.textContent || "");
    }
    setFeedback(ui.imageOptionsFeedback, "");
    setDialog(ui.imageOptionsDialog, true);
  }

  function closeImageOptions() {
    setDialog(ui.imageOptionsDialog, false);
  }

  function applyImageOptions(event) {
    event.preventDefault();
    const object = app.selectedObject;
    if (!object?.isConnected) {
      closeImageOptions();
      return;
    }
    const isTemplate = object.dataset.objectKind === "template";
    const alt = ui.imageAlt.value.trim();
    if (!isTemplate && !alt) {
      setFeedback(ui.imageOptionsFeedback, "Add alt text describing the image.", true);
      ui.imageAlt.focus();
      return;
    }
    const layout = app.selectedImageLayout;
    const isBecomingLayered = ["behind", "front"].includes(layout) &&
      !["behind", "front"].includes(objectLayout(object));
    configurePlacedObject(object, {
      layout,
      widthPercent: ui.imageWidth.value,
      xPercent: isBecomingLayered ? 8 : object.dataset.objectX,
      yPixels: isBecomingLayered ? Math.max(0, object.offsetTop - 36) : object.dataset.objectY,
    });
    if (!isTemplate) {
      object.querySelector("img").alt = alt.slice(0, 240);
      const captionText = ui.imageCaption.value.trim().slice(0, 300);
      let caption = object.querySelector("figcaption");
      if (captionText && !caption) {
        caption = document.createElement("figcaption");
        object.append(caption);
      }
      if (caption) {
        if (captionText) caption.textContent = captionText;
        else caption.remove();
      }
    }
    closeImageOptions();
    if (app.selectedObject !== object) selectFigure(object);
    setFeedback(ui.feedback, `${isTemplate ? "Template" : "Image"} layout updated. Save the page to publish it.`);
  }

  function removeSelectedImage() {
    const object = app.selectedObject;
    if (!object?.isConnected) {
      closeImageOptions();
      return;
    }
    const label = object.dataset.objectKind === "template" ? "Template" : "Image";
    object.__templateResizeObserver?.disconnect?.();
    object.remove();
    closeImageOptions();
    clearSelectedFigure();
    normalizeEditableRoot();
    setFeedback(ui.feedback, `${label} removed from this draft. Save the page to publish the change.`);
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
    if (!app.editing || app.switchingMode || ui.savePage.disabled) return;
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
      const content = readEditedContent();
      if (new TextEncoder().encode(JSON.stringify(content)).length > 250000) {
        throw new Error("This page is too large to save. Shorten the text or split it into smaller pages.");
      }
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
        content,
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
      if (app.editorMode === "wikitext") setFeedback(ui.sourceStatus, error.message || "The revision could not be saved.", true);
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

  function openMediaDialog(options = {}) {
    if (!app.editing) {
      return;
    }
    app.mediaTargetInput = options.targetInput || null;
    app.mediaTargetDisplay = options.targetDisplay || null;
    app.mediaTargetButton = options.targetButton || null;
    if (!app.mediaTargetInput) saveCurrentSelection();
    ui.mediaForm.reset();
    app.selectedMediaId = app.mediaTargetInput?.value || "";
    ui.mediaDialogTitle.textContent = app.mediaTargetInput ? "Choose a template image" : "Import from image catalog";
    ui.mediaAltField.hidden = Boolean(app.mediaTargetInput);
    ui.mediaCaptionField.hidden = Boolean(app.mediaTargetInput);
    ui.mediaAlt.required = !app.mediaTargetInput;
    ui.uploadMedia.textContent = app.mediaTargetInput ? "Use Selected Image" : "Insert Selected Image";
    ui.uploadMedia.disabled = true;
    ui.mediaPreview.hidden = true;
    ui.mediaCatalogGrid.innerHTML = '<div class="media-catalog-state">Loading catalog images...</div>';
    setFeedback(ui.mediaFeedback, "");
    setDialog(ui.mediaDialog, true);
    loadMediaCatalog().then(() => {
      if (app.selectedMediaId) selectCatalogImage(app.selectedMediaId);
    });
    window.setTimeout(() => ui.mediaCatalogSearch.focus(), 0);
  }

  function closeMediaDialog() {
    setDialog(ui.mediaDialog, false);
    app.mediaTargetInput = null;
    app.mediaTargetDisplay = null;
    app.mediaTargetButton = null;
  }

  async function catalogImageUrl(media) {
    if (app.mediaObjectUrls.has(media.id)) return app.mediaObjectUrls.get(media.id);
    const url = URL.createObjectURL(await mediaClient.getBlob(media.id));
    app.mediaObjectUrls.set(media.id, url);
    return url;
  }

  async function hydrateCatalogThumbnail(container, media) {
    try {
      const image = document.createElement("img");
      image.alt = media.altText || "";
      image.src = await catalogImageUrl(media);
      container.replaceChildren(image);
    } catch {
      container.textContent = "Preview unavailable";
    }
  }

  function renderMediaCatalog() {
    ui.mediaCatalogGrid.replaceChildren();
    if (!app.media.length) {
      const empty = document.createElement("div");
      empty.className = "media-catalog-state";
      empty.textContent = ui.mediaCatalogSearch.value.trim()
        ? "No catalog images match that search."
        : "The catalog is empty. Open the full catalog to import an image from your files.";
      ui.mediaCatalogGrid.append(empty);
      return;
    }
    app.media.forEach((media) => {
      const card = document.createElement("button");
      card.className = `media-catalog-card${media.id === app.selectedMediaId ? " is-selected" : ""}`;
      card.type = "button";
      card.dataset.mediaId = media.id;
      const thumbnail = document.createElement("span");
      thumbnail.className = "media-catalog-thumb";
      thumbnail.textContent = "Loading...";
      const title = document.createElement("span");
      title.className = "media-catalog-copy";
      title.textContent = media.title || media.originalName;
      card.append(thumbnail, title);
      ui.mediaCatalogGrid.append(card);
      hydrateCatalogThumbnail(thumbnail, media);
    });
  }

  async function loadMediaCatalog() {
    try {
      const payload = await mediaClient.list({ query: ui.mediaCatalogSearch.value.trim(), sort: "newest", limit: 100 });
      app.media = payload.media || [];
      if (app.selectedMediaId && !app.media.some((item) => item.id === app.selectedMediaId)) app.selectedMediaId = "";
      renderMediaCatalog();
      setFeedback(ui.mediaFeedback, `${payload.pagination?.total ?? app.media.length} catalog image${(payload.pagination?.total ?? app.media.length) === 1 ? "" : "s"}.`);
    } catch (error) {
      ui.mediaCatalogGrid.innerHTML = '<div class="media-catalog-state">Catalog unavailable.</div>';
      setFeedback(ui.mediaFeedback, error.message || "The image catalog could not be loaded.", true);
    }
  }

  async function selectCatalogImage(id) {
    const media = app.media.find((item) => item.id === id);
    if (!media) return;
    app.selectedMediaId = media.id;
    ui.mediaAlt.value = media.altText || "";
    ui.mediaCaption.value = media.defaultCaption || "";
    ui.uploadMedia.disabled = false;
    renderMediaCatalog();
    ui.mediaPreview.hidden = false;
    ui.mediaPreview.replaceChildren();
    const image = document.createElement("img");
    image.alt = media.altText || "";
    try { image.src = await catalogImageUrl(media); }
    catch { image.hidden = true; }
    const copy = document.createElement("div");
    copy.className = "media-selection-copy";
    const name = document.createElement("strong");
    name.textContent = media.title || media.originalName;
    const description = document.createElement("span");
    description.textContent = media.description || "No catalog description.";
    copy.append(name, description);
    ui.mediaPreview.append(image, copy);
  }

  function insertDocumentBlock(element) {
    const selection = window.getSelection();
    const anchor = restoreSavedSelection() && selection.rangeCount
      ? directContentChild(selection.getRangeAt(0).endContainer) : null;
    if (anchor) anchor.after(element);
    else ui.content.append(element);
    const paragraph = document.createElement("p");
    paragraph.append(document.createElement("br"));
    element.after(paragraph);
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertUploadedImage(media, { alt, caption }) {
    const figure = document.createElement("figure");
    figure.contentEditable = "false";
    figure.dataset.wikiMediaId = media.id;
    figure.dataset.wikiMediaUrl = "";
    configureFigure(figure, { layout: "wrap-right", widthPercent: 46, xPercent: 0, yPixels: 0 });
    const image = document.createElement("img");
    image.alt = alt;
    image.src = app.mediaObjectUrls.get(media.id) || "";
    figure.append(image);
    if (caption) {
      const captionElement = document.createElement("figcaption");
      captionElement.textContent = caption;
      figure.append(captionElement);
    }

    insertDocumentBlock(figure);
    closeMediaDialog();
    ui.content.focus();
    selectFigure(figure);
    setFeedback(ui.feedback, "Image inserted beside the text. Drag it to move, use its corner handles to resize, or open Layout Options.");
  }

  function renderTemplateChoices() {
    ui.templateList.replaceChildren();
    if (!app.templates.length) {
      const empty = document.createElement("p");
      empty.className = "wiki-list-state";
      empty.textContent = "No templates have been created yet. Open Template Studio to create one.";
      ui.templateList.append(empty);
      return;
    }
    app.templates.forEach((template) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `template-picker-option${template.id === app.selectedTemplateId ? " is-selected" : ""}`;
      button.dataset.templateId = template.id;
      const title = document.createElement("strong");
      title.textContent = template.name;
      const detail = document.createElement("span");
      const placeholderCount = Array.isArray(template.placeholders) ? template.placeholders.length : 0;
      detail.textContent = `${placeholderCount} placeholder${placeholderCount === 1 ? "" : "s"} · Revision ${template.currentRevision?.number || 1}`;
      button.append(title, detail);
      ui.templateList.append(button);
    });
  }

  function selectedTemplate() {
    return app.templates.find((template) => template.id === app.selectedTemplateId) || null;
  }

  function renderTemplateValueFields(values = {}) {
    const template = selectedTemplate();
    ui.templateValues.replaceChildren();
    if (!template) {
      ui.insertTemplate.disabled = true;
      return;
    }
    const placeholders = Array.isArray(template.placeholders) ? template.placeholders : [];
    if (!placeholders.length) {
      const note = document.createElement("p");
      note.className = "template-picker-note";
      note.textContent = "This design has no placeholders. It will be inserted exactly as drawn.";
      ui.templateValues.append(note);
    } else {
      placeholders.forEach((placeholder) => {
        if (placeholder.kind === "image") {
          const field = document.createElement("div");
          field.className = "template-image-field";
          const caption = document.createElement("span");
          caption.className = "field-label";
          caption.textContent = placeholder.label || String(placeholder.key).replaceAll("_", " ");
          const input = document.createElement("input");
          input.type = "hidden";
          input.dataset.templateValue = placeholder.key;
          input.value = String(values?.[placeholder.key] || "");
          const choice = document.createElement("div");
          choice.className = "template-image-choice";
          const selected = document.createElement("strong");
          const currentMedia = app.media.find((item) => item.id === input.value);
          selected.textContent = currentMedia?.title || (input.value ? "Catalog image selected" : "No image selected");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary-button";
          button.textContent = input.value ? "Change Image" : "Choose Image";
          button.addEventListener("click", () => openMediaDialog({ targetInput: input, targetDisplay: selected, targetButton: button }));
          choice.append(selected, button);
          field.append(caption, input, choice);
          ui.templateValues.append(field);
          return;
        }
        const label = document.createElement("label");
        const caption = document.createElement("span");
        caption.className = "field-label";
        caption.textContent = placeholder.label || String(placeholder.key).replaceAll("_", " ");
        const input = document.createElement(String(placeholder.defaultValue || "").length > 100 ? "textarea" : "input");
        if (input.tagName === "TEXTAREA") input.rows = 3;
        input.dataset.templateValue = placeholder.key;
        input.maxLength = 1000;
        input.value = String(values?.[placeholder.key] ?? placeholder.defaultValue ?? "");
        input.placeholder = String(placeholder.defaultValue || "Enter a value");
        label.append(caption, input);
        ui.templateValues.append(label);
      });
    }
    ui.insertTemplate.disabled = false;
  }

  async function chooseTemplate(templateId, values = {}) {
    app.selectedTemplateId = templateId;
    renderTemplateChoices();
    const template = await loadTemplate(templateId);
    if (template) {
      const index = app.templates.findIndex((item) => item.id === template.id);
      if (index >= 0) app.templates[index] = template;
      renderTemplateChoices();
    }
    renderTemplateValueFields(values);
  }

  async function openTemplateDialog(templateNode = null) {
    if (!app.editing) return;
    if (!templateNode) saveCurrentSelection();
    app.editingTemplateNode = templateNode;
    app.selectedTemplateId = templateNode?.__wikiTemplateBlock?.templateId || "";
    ui.templateStudio.hidden = !viewer()?.isAssignedStaff;
    setFeedback(ui.templateFeedback, "Loading reusable templates...");
    setDialog(ui.templateDialog, true);
    try {
      await loadTemplates({ force: true });
      renderTemplateChoices();
      if (app.selectedTemplateId) {
        await chooseTemplate(app.selectedTemplateId, templateNode?.__wikiTemplateBlock?.values || {});
      } else if (app.templates[0]) {
        await chooseTemplate(app.templates[0].id);
      } else {
        renderTemplateValueFields();
      }
      setFeedback(ui.templateFeedback, "");
    } catch (error) {
      ui.templateList.replaceChildren();
      setFeedback(ui.templateFeedback, error?.message || "Templates could not be loaded.", true);
    }
  }

  function closeTemplateDialog() {
    setDialog(ui.templateDialog, false);
    app.editingTemplateNode = null;
    app.selectedTemplateId = "";
  }

  function templateValuesFromForm() {
    const values = {};
    ui.templateValues.querySelectorAll("[data-template-value]").forEach((input) => {
      values[input.dataset.templateValue] = input.value.slice(0, 1000);
    });
    return values;
  }

  function insertTemplateBlock(event) {
    event.preventDefault();
    const template = selectedTemplate();
    if (!template?.currentRevision?.definition) {
      setFeedback(ui.templateFeedback, "Choose a template first.", true);
      return;
    }
    const previous = app.editingTemplateNode;
    const block = {
      type: "template",
      templateId: template.id,
      templateSlug: template.slug,
      templateRevisionId: template.currentRevision.id,
      values: templateValuesFromForm(),
      snapshot: clone(template.currentRevision.definition),
      layout: previous ? objectLayout(previous) : "wrap-right",
      widthPercent: previous ? objectWidth(previous) : 46,
      xPercent: previous ? clampNumber(previous.dataset.objectX, 0, 85, 0) : 0,
      yPixels: previous ? clampNumber(previous.dataset.objectY, 0, 5000, 0) : 0,
    };
    const instance = createTemplateInstance(block);
    if (previous?.isConnected) {
      previous.__templateResizeObserver?.disconnect?.();
      previous.replaceWith(instance);
    } else {
      insertDocumentBlock(instance);
    }
    closeTemplateDialog();
    ui.content.focus();
    selectFigure(instance);
    setFeedback(ui.feedback, `“${template.name}” inserted beside the text. Drag it to move, resize with the corner handles, or double-click it to change values.`);
  }

  async function handleMediaUpload(event) {
    event.preventDefault();
    const media = app.media.find((item) => item.id === app.selectedMediaId);
    const alt = ui.mediaAlt.value.trim();
    const caption = ui.mediaCaption.value.trim();
    if (!media) {
      setFeedback(ui.mediaFeedback, "Choose an image from the catalog first.", true);
      return;
    }
    if (app.mediaTargetInput) {
      const targetInput = app.mediaTargetInput;
      const targetDisplay = app.mediaTargetDisplay;
      const targetButton = app.mediaTargetButton;
      targetInput.value = media.id;
      if (targetDisplay) targetDisplay.textContent = media.title || media.originalName || "Catalog image selected";
      if (targetButton) targetButton.textContent = "Change Image";
      closeMediaDialog();
      setFeedback(ui.templateFeedback, `“${media.title || media.originalName}” selected for this template image.`);
      return;
    }
    if (!alt) {
      setFeedback(ui.mediaFeedback, "Add alt text describing the image.", true);
      ui.mediaAlt.focus();
      return;
    }
    ui.uploadMedia.disabled = true;
    insertUploadedImage(media, { alt, caption });
  }

  function openPageManagement() {
    const page = app.currentPage;
    if (!app.editing || !page?.permissions?.canManagePage) {
      return;
    }
    ui.managementTitle.textContent = `${page.title} settings`;
    ui.managementNormalEdits.checked = Boolean(page.allowNormalEdits);
    ui.managementCategories.value = (page.categories || []).map((category) => category.name).join(", ");
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

  async function updateManagedCategories() {
    const page = app.currentPage;
    if (!page?.permissions?.canManagePage) return;
    const categories = ui.managementCategories.value.split(",")
      .map((value) => value.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    ui.saveCategories.disabled = true;
    setFeedback(ui.managementFeedback, "Saving categories...");
    try {
      const payload = await mutatePage(page.slug, { action: "update_page_categories", categories });
      app.currentPage = payload.page;
      if (app.editingBasePage) app.editingBasePage.categories = clone(payload.page.categories || []);
      renderPageCategories(payload.page);
      await refreshPageList();
      setFeedback(ui.managementFeedback, categories.length
        ? `${payload.page.categories.length} categor${payload.page.categories.length === 1 ? "y" : "ies"} saved.`
        : "All categories removed from this page.");
    } catch (error) {
      setFeedback(ui.managementFeedback, error?.message || "The categories could not be saved.", true);
    } finally {
      ui.saveCategories.disabled = false;
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
      renderContent(ui.selectedPreview, payload.revision.content, { liveTemplates: false });
      renderContent(ui.currentPreview, app.currentPage.currentRevision?.content, { liveTemplates: false });
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

  function directContentChild(target) {
    let element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    while (element && element.parentElement !== ui.content) {
      element = element.parentElement;
    }
    return element?.parentElement === ui.content ? element : null;
  }

  function beginObjectResize(event, handle) {
    const object = handle?.closest(".wiki-placed-object");
    if (!app.editing || !isPlacedObject(object) || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (app.selectedObject !== object) selectFigure(object);
    app.objectResize = {
      object,
      pointerId: event.pointerId,
      corner: handle.dataset.resizeCorner || "se",
      startClientX: event.clientX,
      startWidth: objectWidth(object),
      contentWidth: Math.max(1, ui.content.getBoundingClientRect().width),
    };
    object.draggable = false;
    object.classList.add("is-object-resizing");
    handle.setPointerCapture?.(event.pointerId);
  }

  function resizePlacedObject(event) {
    const resize = app.objectResize;
    if (!resize || resize.pointerId !== event.pointerId || !resize.object.isConnected) return;
    event.preventDefault();
    const direction = resize.corner.includes("w") ? -1 : 1;
    const width = clampNumber(
      resize.startWidth + direction * ((event.clientX - resize.startClientX) / resize.contentWidth) * 100,
      20,
      100,
      resize.startWidth
    );
    configurePlacedObject(resize.object, {
      layout: objectLayout(resize.object),
      widthPercent: width,
      xPercent: resize.object.dataset.objectX,
      yPixels: resize.object.dataset.objectY,
    });
  }

  function finishObjectResize(event) {
    const resize = app.objectResize;
    if (!resize || (event?.pointerId !== undefined && resize.pointerId !== event.pointerId)) return;
    resize.object.classList.remove("is-object-resizing");
    configurePlacedObject(resize.object);
    app.objectResize = null;
    setFeedback(ui.feedback, `${resize.object.dataset.objectKind === "template" ? "Template" : "Image"} resized. Save the page to publish it.`);
  }

  function beginLayeredImageDrag(event, object) {
    const layout = objectLayout(object);
    if (!app.editing || !["behind", "front"].includes(layout) || event.button !== 0) {
      return;
    }
    event.preventDefault();
    selectFigure(object);
    const contentRect = ui.content.getBoundingClientRect();
    app.layeredDrag = {
      object,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: clampNumber(object.dataset.objectX, 0, 85, 0),
      startY: clampNumber(object.dataset.objectY, 0, 5000, 0),
      contentWidth: Math.max(1, contentRect.width),
    };
    object.classList.add("is-object-dragging", "is-image-dragging");
    object.setPointerCapture?.(event.pointerId);
  }

  function moveLayeredImage(event) {
    const drag = app.layeredDrag;
    if (!drag || drag.pointerId !== event.pointerId || !drag.object.isConnected) {
      return;
    }
    const width = objectWidth(drag.object);
    const maximumX = Math.max(0, 100 - Math.min(width, 85));
    const x = clampNumber(
      drag.startX + ((event.clientX - drag.startClientX) / drag.contentWidth) * 100,
      0,
      maximumX,
      drag.startX
    );
    const y = clampNumber(
      drag.startY + event.clientY - drag.startClientY,
      0,
      5000,
      drag.startY
    );
    configurePlacedObject(drag.object, {
      layout: objectLayout(drag.object),
      widthPercent: width,
      xPercent: x,
      yPixels: y,
    });
  }

  function finishLayeredImageDrag(event) {
    const drag = app.layeredDrag;
    if (!drag || (event?.pointerId !== undefined && drag.pointerId !== event.pointerId)) {
      return;
    }
    const kind = drag.object.dataset.objectKind === "template" ? "Template" : "Image";
    drag.object.classList.remove("is-object-dragging", "is-image-dragging");
    drag.object.releasePointerCapture?.(drag.pointerId);
    app.layeredDrag = null;
    setFeedback(ui.feedback, `${kind} position updated. Save the page to publish it.`);
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
    const buttons = [...ui.searchResults.querySelectorAll("[data-slug], [data-category-slug]")];
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
    const category = event.target.closest("[data-category-slug]");
    if (category) {
      app.searchMode = "categories";
      app.selectedCategory = category.dataset.categorySlug;
      renderSearchResults();
      ui.searchMenuInput.focus({ preventScroll: true });
      return;
    }
    const button = event.target.closest("[data-slug]");
    if (button) {
      openPage(button.dataset.slug);
    }
  });

  ui.newPage.addEventListener("click", openNewPageDialog);
  ui.browseAllPages.addEventListener("click", () => browseSearchMode("all"));
  ui.browseCategories.addEventListener("click", () => browseSearchMode("categories"));
  ui.browseRedirects.addEventListener("click", () => browseSearchMode("redirects"));
  ui.openTrash.addEventListener("click", openTrashDialog);
  ui.closeSearch.addEventListener("click", closeSearchResults);
  ui.editPage.addEventListener("click", enterEditing);
  ui.historyButton.addEventListener("click", openHistory);
  ui.savePage.addEventListener("click", saveEditing);
  ui.modeVisual.addEventListener("click", () => switchEditorMode("visual"));
  ui.modeWikitext.addEventListener("click", () => switchEditorMode("wikitext"));
  ui.sourcePreviewButton.addEventListener("click", previewWikitext);
  ui.sourceHelpButton.addEventListener("click", () => {
    ui.sourceHelp.hidden = !ui.sourceHelp.hidden;
    ui.sourceHelpButton.setAttribute("aria-expanded", String(!ui.sourceHelp.hidden));
  });
  ui.source.addEventListener("input", () => {
    ui.sourcePreview.hidden = true;
    ui.sourcePreviewButton.setAttribute("aria-expanded", "false");
    setFeedback(ui.sourceStatus, "Unsaved changes. Preview to check your markup.");
  });
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
  ui.image.addEventListener("click", () => openMediaDialog());
  ui.template.addEventListener("click", () => openTemplateDialog());
  ui.pageSettings.addEventListener("click", openPageManagement);
  ui.blockStyle.addEventListener("change", () => executeEditorCommand("formatBlock", ui.blockStyle.value));
  ui.fontFamily.addEventListener("change", () => executeEditorCommand("fontName", ui.fontFamily.value));
  ui.link.addEventListener("click", openLinkPopover);
  ui.imageOptions.addEventListener("click", openImageOptions);
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
  ui.content.addEventListener("click", (event) => {
    if (!app.editing) return;
    const object = event.target.closest(".wiki-placed-object");
    if (isPlacedObject(object)) selectFigure(object);
    else clearSelectedFigure();
  });
  ui.content.addEventListener("dblclick", (event) => {
    const template = event.target.closest(".wiki-template-instance");
    if (app.editing && template?.parentElement === ui.content) {
      event.preventDefault();
      openTemplateDialog(template);
      return;
    }
    const figure = event.target.closest("figure[data-wiki-media-id]");
    if (app.editing && isPlacedObject(figure)) {
      event.preventDefault();
      selectFigure(figure);
      openImageOptions();
    }
  });
  ui.content.addEventListener("dragstart", (event) => {
    const object = event.target.closest(".wiki-placed-object");
    if (!app.editing || !isPlacedObject(object) || ["behind", "front"].includes(objectLayout(object))) {
      event.preventDefault();
      return;
    }
    app.draggingObject = object;
    app.draggingFigure = object.dataset.objectKind === "image" ? object : null;
    object.classList.add("is-object-dragging", "is-image-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", object.dataset.wikiMediaId || object.dataset.wikiTemplateId || "wiki-object");
  });
  ui.content.addEventListener("dragover", (event) => {
    if (!app.draggingObject) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  ui.content.addEventListener("drop", (event) => {
    const object = app.draggingObject;
    if (!object) return;
    event.preventDefault();
    const target = directContentChild(event.target);
    if (target && target !== object) {
      const bounds = target.getBoundingClientRect();
      target.insertAdjacentElement(event.clientY < bounds.top + bounds.height / 2 ? "beforebegin" : "afterend", object);
    } else if (!target) {
      ui.content.append(object);
    }
    const label = object.dataset.objectKind === "template" ? "Template" : "Image";
    object.classList.remove("is-object-dragging", "is-image-dragging");
    app.draggingObject = null;
    app.draggingFigure = null;
    selectFigure(object);
    setFeedback(ui.feedback, `${label} moved. Save the page to publish its new position.`);
  });
  ui.content.addEventListener("dragend", () => {
    app.draggingObject?.classList.remove("is-object-dragging", "is-image-dragging");
    app.draggingObject = null;
    app.draggingFigure = null;
  });
  ui.content.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".object-resize-handle");
    if (handle) {
      beginObjectResize(event, handle);
      return;
    }
    const object = event.target.closest(".wiki-placed-object");
    if (isPlacedObject(object)) beginLayeredImageDrag(event, object);
  });
  ui.content.addEventListener("keydown", (event) => {
    const object = app.selectedObject;
    if (!isPlacedObject(object)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      openImageOptions();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && event.target === object) {
      event.preventDefault();
      removeSelectedImage();
      return;
    }
    if (event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      configurePlacedObject(object, {
        layout: objectLayout(object),
        widthPercent: objectWidth(object) + (event.key === "ArrowRight" ? 5 : -5),
        xPercent: object.dataset.objectX,
        yPixels: object.dataset.objectY,
      });
      addResizeHandles(object);
      setFeedback(ui.feedback, `${object.dataset.objectKind === "template" ? "Template" : "Image"} width ${Math.round(objectWidth(object))}%.`);
    }
  });
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

  ui.mediaForm.addEventListener("submit", handleMediaUpload);
  ui.mediaCatalogGrid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-media-id]");
    if (card) selectCatalogImage(card.dataset.mediaId);
  });
  ui.mediaCatalogSearch.addEventListener("input", () => {
    window.clearTimeout(app.mediaSearchTimer);
    app.mediaSearchTimer = window.setTimeout(loadMediaCatalog, 180);
  });
  ui.closeMedia.addEventListener("click", closeMediaDialog);
  ui.cancelMedia.addEventListener("click", closeMediaDialog);

  ui.imageLayoutGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-image-layout]");
    if (button) setImageLayoutChoice(button.dataset.imageLayout);
  });
  ui.imageWidth.addEventListener("input", () => {
    ui.imageWidthOutput.textContent = `${ui.imageWidth.value}%`;
  });
  ui.imageOptionsForm.addEventListener("submit", applyImageOptions);
  ui.closeImageOptions.addEventListener("click", closeImageOptions);
  ui.cancelImageOptions.addEventListener("click", closeImageOptions);
  ui.removeImage.addEventListener("click", removeSelectedImage);

  ui.templateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-template-id]");
    if (button) chooseTemplate(button.dataset.templateId, {});
  });
  ui.templateForm.addEventListener("submit", insertTemplateBlock);
  ui.closeTemplate.addEventListener("click", closeTemplateDialog);
  ui.cancelTemplate.addEventListener("click", closeTemplateDialog);

  ui.closeManagement.addEventListener("click", closePageManagement);
  ui.managementNormalEdits.addEventListener("change", updateManagedEditingPermission);
  ui.saveCategories.addEventListener("click", updateManagedCategories);
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

  ui.categories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-category]");
    if (!button || app.editing) return;
    openSearchMenu();
    app.searchMode = "categories";
    app.selectedCategory = button.dataset.openCategory;
    renderSearchResults();
  });

  [
    ui.searchDialog,
    ui.newDialog,
    ui.historyDialog,
    ui.mediaDialog,
    ui.imageOptionsDialog,
    ui.templateDialog,
    ui.managementDialog,
    ui.trashDialog,
  ].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        if (dialog === ui.searchDialog) closeSearchResults();
        else if (dialog === ui.mediaDialog) closeMediaDialog();
        else if (dialog === ui.imageOptionsDialog) closeImageOptions();
        else if (dialog === ui.templateDialog) closeTemplateDialog();
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
    } else if (!ui.imageOptionsDialog.hidden) {
      closeImageOptions();
    } else if (!ui.templateDialog.hidden) {
      closeTemplateDialog();
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

  document.addEventListener("pointermove", (event) => {
    if (app.objectResize) resizePlacedObject(event);
    else moveLayeredImage(event);
  });
  document.addEventListener("pointerup", (event) => {
    if (app.objectResize) finishObjectResize(event);
    else finishLayeredImageDrag(event);
  });
  document.addEventListener("pointercancel", (event) => {
    if (app.objectResize) finishObjectResize(event);
    else finishLayeredImageDrag(event);
  });

  window.addEventListener("popstate", () => {
    app.currentSlug = slugFromLocation();
    openPage(app.currentSlug, { push: false });
  });
  window.addEventListener("carbon-frontier-testing-snapshot-updated", async () => {
    if (!isTesting() || !viewer()?.canView) {
      return;
    }
    app.templates = [];
    app.templateLoadPromise = null;
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
