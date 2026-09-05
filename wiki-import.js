(function () {
  "use strict";

  const AUTH_STORAGE_KEY = "carbon-frontier-google-session-v1";
  const LOCAL_PAGES_KEY = "carbon-frontier-wiki-local-pages-v3";
  const LOCAL_REDIRECTS_KEY = "carbon-frontier-wiki-local-redirects-v1";
  const LOCAL_TEMPLATES_KEY = "carbon-frontier-wiki-local-templates-v1";
  const IMPORT_ENDPOINTS = ["/api/wiki/import", "/.netlify/functions/wiki-import"];
  const ACCESS_ENDPOINTS = ["/api/wiki-access", "/.netlify/functions/wiki-access"];
  const CURSOR_ACCOUNT = { email: "jb141598@gmail.com", name: "Cursor Testing Owner", idToken: "" };
  const BATCH_SIZE = 8;

  const ui = {
    accountPill: document.getElementById("account-pill"),
    loadingView: document.getElementById("loading-view"),
    unavailableView: document.getElementById("unavailable-view"),
    unavailableCopy: document.getElementById("unavailable-copy"),
    signinSlot: document.getElementById("google-signin-slot"),
    importView: document.getElementById("import-view"),
    sourceUrl: document.getElementById("source-url"),
    conflictMode: document.getElementById("conflict-mode"),
    preview: document.getElementById("preview-button"),
    sourceFeedback: document.getElementById("source-feedback"),
    pagesPanel: document.getElementById("pages-panel"),
    pageFilter: document.getElementById("page-filter"),
    selectAll: document.getElementById("select-all-button"),
    selectionCount: document.getElementById("selection-count"),
    pageList: document.getElementById("page-list"),
    mapMainPage: document.getElementById("map-main-page"),
    importButton: document.getElementById("import-button"),
    progressRow: document.getElementById("progress-row"),
    progress: document.getElementById("import-progress"),
    progressLabel: document.getElementById("progress-label"),
    importFeedback: document.getElementById("import-feedback"),
    results: document.getElementById("results"),
    countImported: document.getElementById("count-imported"),
    countUpdated: document.getElementById("count-updated"),
    countRedirects: document.getElementById("count-redirects"),
    countSkipped: document.getElementById("count-skipped"),
    resultList: document.getElementById("result-list"),
  };

  const state = {
    testing: isTestingEnvironment(),
    account: null,
    idToken: "",
    pages: [],
    selected: new Set(),
    importing: false,
    googleInitialized: false,
    remoteEndpoint: "",
  };

  function isTestingEnvironment() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const context = `${navigator.userAgent || ""} ${document.referrer || ""}`.toLowerCase();
    return window.location.protocol === "file:" ||
      ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
      context.includes("cursor") || context.includes("vscode") || context.includes("electron");
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function slugify(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 100);
  }

  function setFeedback(element, message, isError = false) {
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function getGoogleClientId() {
    return String(document.querySelector('meta[name="google-signin-client_id"]')?.content || "").trim();
  }

  function decodeJwtPayload(token) {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
      return JSON.parse(decodeURIComponent(Array.from(atob(padded)).map((character) =>
        `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`
      ).join("")));
    } catch (error) {
      return null;
    }
  }

  function loadSession() {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
      const payload = decodeJwtPayload(session?.idToken);
      if (!session?.email || !payload?.email || payload.email_verified === false ||
          (payload.exp && Number(payload.exp) * 1000 <= Date.now() + 15_000)) return null;
      return {
        email: normalizeEmail(session.email),
        name: String(session.name || "").trim(),
        idToken: String(session.idToken || ""),
      };
    } catch (error) {
      return null;
    }
  }

  function saveSession(account) {
    if (!state.testing && account?.email) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(account));
  }

  function showUnavailable(message) {
    ui.loadingView.hidden = true;
    ui.importView.hidden = true;
    ui.unavailableView.hidden = false;
    ui.unavailableCopy.textContent = message;
    ui.accountPill.textContent = state.account?.email ? "No import access" : "Sign in required";
    ui.signinSlot.hidden = Boolean(state.account?.email);
    if (!ui.signinSlot.hidden) waitForGoogle();
  }

  function showImportView() {
    ui.loadingView.hidden = true;
    ui.unavailableView.hidden = true;
    ui.importView.hidden = false;
    ui.accountPill.textContent = state.testing
      ? "Owner access · Local testing"
      : `${state.account?.name || "Owner/Admin"} · Import`;
  }

  async function handleGoogleCredential(response) {
    const payload = decodeJwtPayload(response?.credential);
    if (!payload?.email || payload.email_verified === false) {
      showUnavailable("Google did not return a verified email account.");
      return;
    }
    state.account = {
      email: normalizeEmail(payload.email),
      name: String(payload.name || "").trim(),
      idToken: String(response.credential || ""),
    };
    state.idToken = state.account.idToken;
    saveSession(state.account);
    await verifyImportAccess();
  }

  function renderGoogleButton() {
    if (state.testing || !window.google?.accounts?.id) return false;
    if (!state.googleInitialized) {
      window.google.accounts.id.initialize({
        client_id: getGoogleClientId(), callback: handleGoogleCredential,
        auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_prompt: true,
      });
      state.googleInitialized = true;
    }
    ui.signinSlot.replaceChildren();
    window.google.accounts.id.renderButton(ui.signinSlot, {
      theme: "outline", size: "large", shape: "pill", text: "signin_with", width: 270,
    });
    return true;
  }

  function waitForGoogle(attempt = 0) {
    if (renderGoogleButton() || attempt >= 40) return;
    window.setTimeout(() => waitForGoogle(attempt + 1), 250);
  }

  function parseSource() {
    try {
      const url = new URL(ui.sourceUrl.value.trim());
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || !(host === "miraheze.org" || host.endsWith(".miraheze.org"))) {
        throw new Error();
      }
      return { origin: url.origin, apiUrl: new URL("/w/api.php", url.origin) };
    } catch (error) {
      throw new Error("Enter your full HTTPS Miraheze address, such as https://yourwiki.miraheze.org.");
    }
  }

  async function directMediaWikiRequest(parameters) {
    const source = parseSource();
    const url = new URL(source.apiUrl);
    Object.entries({ action: "query", format: "json", formatversion: "2", origin: "*", ...parameters })
      .forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error?.info || `Miraheze request failed (${response.status}).`);
    }
    return payload;
  }

  async function remoteRequest(body) {
    let lastError = new Error("The wiki import service is unavailable.");
    const endpoints = state.remoteEndpoint
      ? [state.remoteEndpoint, ...IMPORT_ENDPOINTS.filter((item) => item !== state.remoteEndpoint)]
      : IMPORT_ENDPOINTS;
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${state.idToken}` },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) {
          lastError = new Error(payload?.error || "Import Function not found.");
          continue;
        }
        if (!response.ok) {
          const error = new Error(payload?.error || `Import request failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        state.remoteEndpoint = endpoint;
        return payload;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status !== 404) throw error;
      }
    }
    throw lastError;
  }

  async function verifyImportAccess() {
    let lastError = new Error("The wiki access service is unavailable.");
    for (const endpoint of ACCESS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          headers: { authorization: `Bearer ${state.idToken}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) {
          lastError = new Error(payload?.error || "Wiki access Function not found.");
          continue;
        }
        if (!response.ok) {
          const error = new Error(payload?.error || `Access check failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        if (!payload?.viewer?.canManageSettings) {
          showUnavailable("Only wiki Owners and Admins can open the Miraheze migration tool.");
          return false;
        }
        showImportView();
        return true;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status !== 404) break;
      }
    }
    showUnavailable(lastError.message);
    return false;
  }

  async function previewLocal() {
    const pages = [];
    let continuation = "";
    do {
      const payload = await directMediaWikiRequest({
        list: "allpages", apnamespace: 0, aplimit: "max",
        ...(continuation ? { apcontinue: continuation } : {}),
      });
      (payload?.query?.allpages || []).forEach((page) => {
        if (pages.length < 2000) pages.push({ pageId: page.pageid, title: page.title, slug: slugify(page.title) });
      });
      continuation = payload?.continue?.apcontinue || "";
    } while (continuation && pages.length < 2000);
    return { ok: true, pages, truncated: Boolean(continuation) };
  }

  function visiblePages() {
    const query = ui.pageFilter.value.trim().toLowerCase();
    return state.pages.filter((page) => !query || `${page.title} ${page.slug}`.toLowerCase().includes(query));
  }

  function updateSelectionUi() {
    ui.selectionCount.textContent = `${state.selected.size} selected · ${state.pages.length} available`;
    ui.importButton.disabled = state.importing || state.selected.size === 0;
    const visible = visiblePages();
    const allVisibleSelected = visible.length > 0 && visible.every((page) => state.selected.has(page.title));
    ui.selectAll.textContent = allVisibleSelected ? "Clear Visible" : "Select Visible";
  }

  function renderPages() {
    const visible = visiblePages();
    ui.pageList.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = state.pages.length ? "No page titles match that filter." : "This wiki did not return any main article pages.";
      ui.pageList.append(empty);
    } else {
      visible.forEach((page) => {
        const label = document.createElement("label");
        label.className = "page-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.selected.has(page.title);
        checkbox.dataset.title = page.title;
        const copy = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = page.title;
        const address = document.createElement("span");
        address.textContent = page.title.toLowerCase() === "main page" ? "Can become /wiki" : `/wiki/${page.slug}`;
        copy.append(title, address);
        const id = document.createElement("small");
        id.textContent = `Page ${page.pageId}`;
        label.append(checkbox, copy, id);
        ui.pageList.append(label);
      });
    }
    updateSelectionUi();
  }

  async function handlePreview() {
    if (state.importing) return;
    try {
      parseSource();
      ui.preview.disabled = true;
      setFeedback(ui.sourceFeedback, "Reading the Miraheze page list...");
      const payload = state.testing
        ? await previewLocal()
        : await remoteRequest({ action: "preview", sourceUrl: ui.sourceUrl.value.trim() });
      state.pages = Array.isArray(payload.pages) ? payload.pages : [];
      state.selected = new Set(state.pages.map((page) => page.title));
      ui.pagesPanel.hidden = false;
      renderPages();
      setFeedback(ui.sourceFeedback,
        `${state.pages.length} page${state.pages.length === 1 ? "" : "s"} found${payload.truncated ? " (the 2,000-page safety limit was reached)" : ""}.`);
      ui.pagesPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setFeedback(ui.sourceFeedback, error?.message || "The Miraheze wiki could not be previewed.", true);
    } finally {
      ui.preview.disabled = false;
    }
  }

  function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function localInline(value) {
    let text = escapeHtml(value);
    text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, label) =>
      `<a href="/wiki/${encodeURIComponent(slugify(target))}">${escapeHtml(label || target)}</a>`);
    return text
      .replace(/&#039;&#039;&#039;(.+?)&#039;&#039;&#039;/g, "<strong>$1</strong>")
      .replace(/&#039;&#039;(.+?)&#039;&#039;/g, "<em>$1</em>");
  }

  function normalizeTemplateIdentifier(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/^template\s*:/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function normalizedParameterKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function templatePlaceholders(template) {
    const seen = new Set();
    return (Array.isArray(template?.placeholders) && template.placeholders.length
      ? template.placeholders
      : (template?.currentRevision?.definition?.elements || []).filter((element) =>
        ["placeholder", "image-placeholder"].includes(element?.type)
      ).map((element) => ({
        key: element.placeholderKey,
        kind: element.type === "image-placeholder" ? "image" : "text",
      })))
      .filter((placeholder) => {
        const key = normalizedParameterKey(placeholder?.key);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function parseTemplateInvocation(raw) {
    const source = String(raw || "").trim();
    if (!source.startsWith("{{") || !source.endsWith("}}")) return null;
    const inner = source.slice(2, -2).trim();
    const nameMatch = inner.match(/^([^|]*?)(?=\s+[A-Za-z][A-Za-z0-9_-]*\s*=|\||$)/);
    const name = String(nameMatch?.[1] || "").trim().replace(/^Template\s*:/i, "");
    if (!name) return null;
    const parameterSource = inner.slice(nameMatch[0].length).replace(/^\s*\|?\s*/, "");
    const matches = [];
    const pattern = /(?:^|[|\s])([A-Za-z][A-Za-z0-9_-]*)\s*=/g;
    let match;
    while ((match = pattern.exec(parameterSource))) {
      matches.push({ key: match[1], start: match.index, valueStart: pattern.lastIndex });
    }
    const parameters = {};
    matches.forEach((item, index) => {
      const end = matches[index + 1]?.start ?? parameterSource.length;
      parameters[item.key] = parameterSource.slice(item.valueStart, end)
        .replace(/[|\s]+$/g, "").trim().slice(0, 1000);
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
          const invocation = parseTemplateInvocation(source.slice(start, end));
          if (invocation) calls.push({ ...invocation, start, end });
          start = -1;
        }
        index += 1;
      }
    }
    return calls.slice(0, 100);
  }

  function readLocalTemplates() {
    let saved = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_TEMPLATES_KEY) || "[]");
      if (Array.isArray(parsed)) saved = parsed;
    } catch (error) { /* Use synchronized templates when local data is unavailable. */ }
    const synchronized = window.CarbonFrontierTestingSync?.getSection("wiki")?.templates;
    const templates = new Map();
    if (Array.isArray(synchronized)) synchronized.forEach((template) => templates.set(template.id, template));
    saved.forEach((template) => templates.set(template.id, template));
    return [...templates.values()].filter((template) => !template.isDeleted);
  }

  function matchingTemplate(invocation, templates) {
    const wanted = normalizeTemplateIdentifier(invocation?.name);
    return templates.find((template) => [template.name, template.slug]
      .some((value) => normalizeTemplateIdentifier(value) === wanted)) || null;
  }

  function normalizedFileTitle(value) {
    const cleaned = String(value || "").replace(/^\[\[(?:File|Image):/i, "")
      .replace(/\]\]$/g, "").split("|")[0].replace(/^File:/i, "").trim().replaceAll("_", " ");
    return cleaned ? `File:${cleaned}` : "";
  }

  function localCategories(wikitext) {
    const unique = new Map();
    String(wikitext || "").replace(/\[\[Category:([^|\]]+)(?:\|[^\]]*)?\]\]/gi, (_match, value) => {
      const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const slug = slugify(name).slice(0, 80);
      if (name && slug && !unique.has(slug)) unique.set(slug, { id: `local-category-${slug}`, slug, name });
      return _match;
    });
    return [...unique.values()].slice(0, 20);
  }

  async function localImageMap(wikitexts, templates) {
    const names = [];
    const combined = wikitexts.join("\n");
    combined.replace(/\[\[(?:File|Image):([^|\]]+)/gi, (_match, name) => {
      const title = `File:${String(name).trim().replaceAll("_", " ")}`;
      if (!names.some((item) => item.toLowerCase() === title.toLowerCase())) names.push(title);
      return _match;
    });
    topLevelTemplateInvocations(combined).forEach((invocation) => {
      const template = matchingTemplate(invocation, templates);
      if (!template) return;
      const parameters = new Map(Object.entries(invocation.parameters)
        .map(([key, value]) => [normalizedParameterKey(key), value]));
      templatePlaceholders(template).filter((placeholder) => placeholder.kind === "image").forEach((placeholder) => {
        const title = normalizedFileTitle(parameters.get(normalizedParameterKey(placeholder.key)));
        if (title && !names.some((item) => item.toLowerCase() === title.toLowerCase())) names.push(title);
      });
    });
    if (!names.length) return new Map();
    const payload = await directMediaWikiRequest({ prop: "imageinfo", titles: names.slice(0, 24).join("|"), iiprop: "url|mime|size", iilimit: 1 });
    return new Map((payload?.query?.pages || []).filter((page) => page.imageinfo?.[0]?.url).map((page) =>
      [String(page.title).toLowerCase(), page.imageinfo[0].url]
    ));
  }

  function localTemplateBlock(invocation, template, images) {
    const parameters = new Map(Object.entries(invocation.parameters)
      .map(([key, value]) => [normalizedParameterKey(key), String(value || "").trim()]));
    const values = {};
    templatePlaceholders(template).forEach((placeholder) => {
      const raw = parameters.get(normalizedParameterKey(placeholder.key));
      if (raw === undefined) return;
      values[placeholder.key] = placeholder.kind === "image"
        ? images.get(normalizedFileTitle(raw).toLowerCase()) || ""
        : raw.slice(0, 1000);
    });
    return {
      id: crypto.randomUUID(), type: "template", templateId: template.id,
      templateSlug: template.slug, templateRevisionId: template.currentRevision?.id || "",
      values, snapshot: template.currentRevision?.definition || null,
      layout: "wrap-right", widthPercent: 46, xPercent: 0, yPixels: 0,
    };
  }

  function localDocument(wikitext, images, templates) {
    const tokens = [];
    const templateTokens = [];
    let source = String(wikitext || "").replace(/<!--[^]*?-->/g, "")
      .replace(/\[\[Category:[^\]]+\]\]/gi, "");
    const calls = topLevelTemplateInvocations(source);
    if (calls.length && templates.length) {
      let output = "";
      let cursor = 0;
      calls.forEach((invocation) => {
        const template = matchingTemplate(invocation, templates);
        if (!template) return;
        output += source.slice(cursor, invocation.start);
        const token = `@@LOCALTEMPLATE${templateTokens.length}@@`;
        templateTokens.push(localTemplateBlock(invocation, template, images));
        output += `\n${token}\n`;
        cursor = invocation.end;
      });
      source = `${output}${source.slice(cursor)}`;
    }
    source = source
      .replace(/\[\[Category:[^\]]+\]\]/gi, "")
      .replace(/\[\[(?:File|Image):([^|\]]+)(?:\|([^\]]*))?\]\]/gi, (_match, name, options = "") => {
        const title = `File:${String(name).trim().replaceAll("_", " ")}`;
        const url = images.get(title.toLowerCase());
        const parts = String(options).split("|").map((part) => part.trim()).filter(Boolean);
        const caption = parts.filter((part) => !/^(thumb|left|right|center|none|\d+px)$/i.test(part)).at(-1) || "";
        const token = `@@LOCALIMAGE${tokens.length}@@`;
        tokens.push(url ? {
          id: crypto.randomUUID(), type: "image", mediaId: `imported-${crypto.randomUUID()}`, url,
          alt: caption || name, caption, layout: /\bleft\b/i.test(options) ? "wrap-left" : "wrap-right",
          widthPercent: 46, xPercent: 0, yPixels: 0,
        } : { id: crypto.randomUUID(), type: "paragraph", text: `[Image from Miraheze: ${name}]` });
        return `\n${token}\n`;
      });
    const blocks = [];
    let paragraph = [];
    let list = null;
    const flushParagraph = () => {
      const text = paragraph.join(" ").trim();
      if (text) blocks.push({ id: crypto.randomUUID(), type: "paragraph", html: localInline(text), text });
      paragraph = [];
    };
    const flushList = () => {
      if (list?.items.length) blocks.push({ id: crypto.randomUUID(), type: list.type, items: list.items.map((text) => ({ text, html: localInline(text) })) });
      list = null;
    };
    source.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      const image = line.match(/^@@LOCALIMAGE(\d+)@@$/);
      if (image) { flushParagraph(); flushList(); blocks.push(tokens[Number(image[1])]); return; }
      const template = line.match(/^@@LOCALTEMPLATE(\d+)@@$/);
      if (template) { flushParagraph(); flushList(); blocks.push(templateTokens[Number(template[1])]); return; }
      if (!line) { flushParagraph(); flushList(); return; }
      const heading = line.match(/^(={2,4})\s*(.*?)\s*\1$/);
      if (heading) {
        flushParagraph(); flushList();
        blocks.push({ id: crypto.randomUUID(), type: heading[1].length === 2 ? "heading2" : "heading3", html: localInline(heading[2]), text: heading[2] });
        return;
      }
      const item = line.match(/^([*#])\s*(.+)$/);
      if (item) {
        flushParagraph();
        const type = item[1] === "*" ? "bullet-list" : "numbered-list";
        if (list && list.type !== type) flushList();
        if (!list) list = { type, items: [] };
        list.items.push(item[2].replace(/^[*#]+\s*/, ""));
        return;
      }
      if (/^(?:\{\||\|-|\|\})/.test(line)) { flushParagraph(); flushList(); return; }
      paragraph.push(line.replace(/^[!|]+\s*/, "").replace(/\s*(?:!!|\|\|)\s*/g, " · "));
    });
    flushParagraph(); flushList();
    return { type: "document", version: 3, blocks: blocks.length ? blocks : [{ id: crypto.randomUUID(), type: "paragraph", text: "Imported page" }] };
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (error) { return {}; }
  }

  async function importLocalBatch(titles) {
    const payload = await directMediaWikiRequest({
      prop: "revisions", titles: titles.join("|"), rvprop: "content|timestamp|user|comment", rvslots: "main",
    });
    const sourcePages = (payload?.query?.pages || []).filter((page) => !page.missing).map((page) => {
      const revision = page.revisions?.[0] || {};
      return { title: page.title, wikitext: revision.slots?.main?.content ?? revision.content ?? "", user: revision.user || "Unknown editor" };
    });
    const templates = readLocalTemplates();
    const images = await localImageMap(sourcePages.map((page) => page.wikitext), templates);
    const overrides = readJson(LOCAL_PAGES_KEY);
    const redirects = readJson(LOCAL_REDIRECTS_KEY);
    const results = [];
    const now = new Date().toISOString();
    sourcePages.forEach((sourcePage) => {
      const title = String(sourcePage.title).trim().slice(0, 120);
      const slug = ui.mapMainPage.checked && title.toLowerCase() === "main page" ? "front-page" : slugify(title);
      const redirect = sourcePage.wikitext.match(/^\s*#redirect\s*\[\[([^\]|#]+)/i);
      if (redirect) {
        redirects[slug] = slugify(redirect[1]);
        results.push({ title, slug, status: "imported_redirect" });
        return;
      }
      const existing = overrides[slug];
      if (existing && ui.conflictMode.value === "skip" && slug !== "front-page") {
        results.push({ title, slug, status: "skipped", message: "A local page already uses this address." });
        return;
      }
      const previousNumber = Number(existing?.currentRevision?.number || 0);
      const converted = localDocument(sourcePage.wikitext, images, templates);
      const revision = {
        id: `local-import-revision-${crypto.randomUUID()}`, number: previousNumber + 1, title,
        content: converted, editSummary: "Import current revision from Miraheze",
        authorEmail: "system", authorName: `Imported from Miraheze · ${sourcePage.user}`, authorRole: "contributor", createdAt: now,
      };
      const page = {
        id: existing?.id || `local-import-page-${crypto.randomUUID()}`, slug, title,
        allowNormalEdits: existing?.allowNormalEdits ?? true, createdAt: existing?.createdAt || now, updatedAt: now,
        categories: localCategories(sourcePage.wikitext),
        createdBy: existing?.createdBy || "system", updatedBy: "system", currentRevision: revision,
        localRevisions: [...(existing?.localRevisions || (existing?.currentRevision ? [existing.currentRevision] : [])), revision],
      };
      overrides[slug] = page;
      results.push({
        title, slug, status: existing ? "updated" : "imported", revisionNumber: revision.number,
        matchedTemplates: converted.blocks.filter((block) => block.type === "template").length,
      });
    });
    localStorage.setItem(LOCAL_PAGES_KEY, JSON.stringify(overrides));
    localStorage.setItem(LOCAL_REDIRECTS_KEY, JSON.stringify(redirects));
    return { ok: true, results, importedImages: images.size };
  }

  function renderResults(results) {
    const counts = { imported: 0, updated: 0, imported_redirect: 0, skipped: 0 };
    results.forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1; });
    ui.countImported.textContent = counts.imported || 0;
    ui.countUpdated.textContent = counts.updated || 0;
    ui.countRedirects.textContent = counts.imported_redirect || 0;
    ui.countSkipped.textContent = (counts.skipped || 0) + (counts.failed || 0);
    ui.resultList.replaceChildren();
    results.slice(-30).forEach((item) => {
      const row = document.createElement("div");
      row.className = "result-row";
      const title = document.createElement("strong");
      title.textContent = item.title || item.slug || "Wiki page";
      const status = document.createElement("span");
      status.textContent = `${item.status.replaceAll("_", " ")}${item.matchedTemplates ? ` · ${item.matchedTemplates} CF template${item.matchedTemplates === 1 ? "" : "s"}` : ""}`;
      row.append(title, status);
      ui.resultList.append(row);
    });
    ui.results.hidden = false;
  }

  async function handleImport() {
    if (state.importing || !state.selected.size) return;
    const titles = [...state.selected];
    const batches = [];
    for (let index = 0; index < titles.length; index += BATCH_SIZE) batches.push(titles.slice(index, index + BATCH_SIZE));
    const results = [];
    let importedImages = 0;
    let matchedTemplates = 0;
    state.importing = true;
    updateSelectionUi();
    ui.preview.disabled = true;
    ui.progressRow.hidden = false;
    ui.progress.max = titles.length;
    ui.progress.value = 0;
    ui.results.hidden = true;
    setFeedback(ui.importFeedback, "Starting migration...");
    try {
      for (const batch of batches) {
        ui.progressLabel.textContent = `${Math.min(ui.progress.value + 1, titles.length)}–${Math.min(ui.progress.value + batch.length, titles.length)} of ${titles.length}`;
        const payload = state.testing
          ? await importLocalBatch(batch)
          : await remoteRequest({
              action: "import", sourceUrl: ui.sourceUrl.value.trim(), titles: batch,
              conflictMode: ui.conflictMode.value, mapMainPage: ui.mapMainPage.checked,
            });
        results.push(...(payload.results || []));
        importedImages += Number(payload.importedImages || 0);
        matchedTemplates += Number(payload.matchedTemplates || (payload.results || []).reduce(
          (total, item) => total + Number(item.matchedTemplates || 0), 0
        ));
        ui.progress.value += batch.length;
      }
      renderResults(results);
      setFeedback(ui.importFeedback,
        `${results.length} page result${results.length === 1 ? "" : "s"} completed · ${importedImages} image${importedImages === 1 ? "" : "s"} imported · ${matchedTemplates} matching CF template${matchedTemplates === 1 ? "" : "s"} inserted.${state.testing ? " These changes are in the Cursor testing copy only." : ""}`);
    } catch (error) {
      if (results.length) renderResults(results);
      setFeedback(ui.importFeedback, `${error?.message || "The import stopped."} Completed batches were kept.`, true);
    } finally {
      state.importing = false;
      ui.preview.disabled = false;
      ui.progressLabel.textContent = `${ui.progress.value} of ${titles.length}`;
      updateSelectionUi();
    }
  }

  async function initialize() {
    if (state.testing) {
      state.account = CURSOR_ACCOUNT;
      showImportView();
      return;
    }
    const session = loadSession();
    if (session) {
      state.account = session;
      state.idToken = session.idToken;
      await verifyImportAccess();
    } else {
      showUnavailable("Sign in with an Owner or Admin Google account to open the migration tool.");
    }
  }

  ui.preview.addEventListener("click", handlePreview);
  ui.pageFilter.addEventListener("input", renderPages);
  ui.pageList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[data-title]");
    if (!checkbox) return;
    if (checkbox.checked) state.selected.add(checkbox.dataset.title);
    else state.selected.delete(checkbox.dataset.title);
    updateSelectionUi();
  });
  ui.selectAll.addEventListener("click", () => {
    const visible = visiblePages();
    const clear = visible.length > 0 && visible.every((page) => state.selected.has(page.title));
    visible.forEach((page) => clear ? state.selected.delete(page.title) : state.selected.add(page.title));
    renderPages();
  });
  ui.importButton.addEventListener("click", handleImport);
  initialize();
})();
