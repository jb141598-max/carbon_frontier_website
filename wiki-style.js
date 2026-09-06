(function () {
  "use strict";

  const AUTH_STORAGE_KEY = "carbon-frontier-google-session-v1";
  const ENDPOINT = "/api/wiki/style";
  const TESTING_KEY = window.CarbonFrontierWikiStyle.TESTING_KEY;

  const GROUPS = [
    {
      title: "Brand & links",
      copy: "Accent colors used for controls, labels, and wiki links.",
      fields: [
        { key: "accentColor", label: "Accent", type: "color" },
        { key: "accentSoftColor", label: "Soft accent", type: "color" },
        { key: "linkColor", label: "Link color", type: "color" },
        { key: "linkUnderline", label: "Underline links", type: "toggle", wide: true },
      ],
    },
    {
      title: "Text",
      copy: "Article text, metadata, and overall typography.",
      fields: [
        { key: "textColor", label: "Main text", type: "color" },
        { key: "articleTextColor", label: "Article text", type: "color" },
        { key: "mutedTextColor", label: "Muted text", type: "color" },
        { key: "softTextColor", label: "Soft text", type: "color" },
        { key: "fontFamily", label: "Font", type: "select", options: ["Play", "Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"] },
        { key: "baseFontSize", label: "Base size", type: "range", min: 13, max: 22, step: 1, suffix: "px" },
        { key: "articleLineHeight", label: "Line height", type: "range", min: 1.25, max: 2.1, step: 0.05 },
        { key: "headingWeight", label: "Heading weight", type: "select", numeric: true, options: [{ value: 400, label: "Regular" }, { value: 700, label: "Bold" }] },
      ],
    },
    {
      title: "Page background",
      copy: "The three-stage page gradient, grid, and Carbon Frontier glow.",
      fields: [
        { key: "backgroundTop", label: "Background top", type: "color" },
        { key: "backgroundMiddle", label: "Background middle", type: "color" },
        { key: "backgroundBottom", label: "Background bottom", type: "color" },
        { key: "glowEnabled", label: "Accent glow", type: "toggle" },
        { key: "glowStrength", label: "Main glow", type: "range", min: 0, max: 0.55, step: 0.01 },
        { key: "secondaryGlowStrength", label: "Second glow", type: "range", min: 0, max: 0.45, step: 0.01 },
        { key: "gridEnabled", label: "Background grid", type: "toggle" },
        { key: "gridSize", label: "Grid size", type: "range", min: 32, max: 180, step: 4, suffix: "px" },
        { key: "gridOpacity", label: "Grid opacity", type: "range", min: 0, max: 0.16, step: 0.005 },
      ],
    },
    {
      title: "Panels & borders",
      copy: "Control wiki cards, article surfaces, borders, and depth.",
      fields: [
        { key: "panelColor", label: "Panel tint", type: "color" },
        { key: "panelOpacity", label: "Panel opacity", type: "range", min: 0, max: 0.4, step: 0.005 },
        { key: "panelStrongOpacity", label: "Strong panel opacity", type: "range", min: 0, max: 0.55, step: 0.005 },
        { key: "articleColor", label: "Article color", type: "color" },
        { key: "articleOpacity", label: "Article opacity", type: "range", min: 0.55, max: 1, step: 0.01 },
        { key: "borderColor", label: "Border tint", type: "color" },
        { key: "borderOpacity", label: "Border opacity", type: "range", min: 0, max: 0.55, step: 0.005 },
        { key: "shadowOpacity", label: "Shadow strength", type: "range", min: 0, max: 0.8, step: 0.01 },
        { key: "articleRadius", label: "Article corners", type: "range", min: 0, max: 56, step: 2, suffix: "px" },
      ],
    },
    {
      title: "Layout",
      copy: "Set the overall width and spacing of the wiki.",
      fields: [
        { key: "contentMaxWidth", label: "Max page width", type: "range", min: 760, max: 1800, step: 20, suffix: "px" },
        { key: "pagePadding", label: "Page edge padding", type: "range", min: 10, max: 64, step: 2, suffix: "px" },
        { key: "articlePadding", label: "Article padding", type: "range", min: 16, max: 84, step: 2, suffix: "px" },
      ],
    },
  ];

  const ui = {
    accountPill: document.getElementById("account-pill"),
    loading: document.getElementById("loading-view"),
    unavailable: document.getElementById("unavailable-view"),
    unavailableCopy: document.getElementById("unavailable-copy"),
    signinSlot: document.getElementById("google-signin-slot"),
    view: document.getElementById("style-view"),
    list: document.getElementById("style-list"),
    name: document.getElementById("style-name-input"),
    preview: document.getElementById("style-preview"),
    fields: document.getElementById("customizer-fields"),
    feedback: document.getElementById("style-feedback"),
    newButton: document.getElementById("new-style-button"),
    duplicateButton: document.getElementById("duplicate-style-button"),
    activateButton: document.getElementById("activate-style-button"),
    deleteButton: document.getElementById("delete-style-button"),
    resetButton: document.getElementById("reset-draft-button"),
    saveButton: document.getElementById("save-style-button"),
  };

  const state = {
    testing: window.CarbonFrontierWikiStyle.isTestingEnvironment(),
    account: null,
    idToken: "",
    styles: [],
    activeStyleId: "",
    selectedId: "",
    draft: null,
    googleInitialized: false,
    busy: false,
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
  function randomId() { return `style-local-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`; }

  function decodeJwtPayload(token) {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = `${base64}${"=".repeat((4 - base64.length % 4) % 4)}`;
      const decoded = atob(padded);
      return JSON.parse(decodeURIComponent(Array.from(decoded).map((character) =>
        `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
    } catch { return null; }
  }

  function loadSession() {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
      const payload = decodeJwtPayload(session?.idToken);
      if (!session?.email || !payload?.email || payload.email_verified === false ||
          (payload.exp && Number(payload.exp) * 1000 <= Date.now() + 15000)) return null;
      return {
        email: normalizeEmail(session.email),
        name: String(session.name || "").trim(),
        picture: String(session.picture || "").trim(),
        idToken: String(session.idToken || ""),
      };
    } catch { return null; }
  }

  function saveSession(account) {
    if (!state.testing && account?.email) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(account));
  }

  function setFeedback(message, error = false) {
    ui.feedback.textContent = message || "";
    ui.feedback.classList.toggle("is-error", Boolean(error));
  }

  function setBusy(busy) {
    state.busy = busy;
    [ui.newButton, ui.duplicateButton, ui.activateButton, ui.deleteButton, ui.resetButton, ui.saveButton]
      .forEach((button) => { button.disabled = busy; });
  }

  function getGoogleClientId() {
    return String(document.querySelector('meta[name="google-signin-client_id"]')?.content || "").trim();
  }

  function handleGoogleCredential(response) {
    const payload = decodeJwtPayload(response?.credential);
    if (!payload?.email || payload.email_verified === false) {
      showUnavailable("Google did not return a verified email account.");
      return;
    }
    state.account = {
      email: normalizeEmail(payload.email),
      name: String(payload.name || "").trim(),
      picture: String(payload.picture || "").trim(),
      idToken: String(response.credential || ""),
    };
    state.idToken = state.account.idToken;
    saveSession(state.account);
    loadManagement();
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
    setTimeout(() => waitForGoogle(attempt + 1), 250);
  }

  function showUnavailable(message) {
    ui.loading.hidden = true;
    ui.view.hidden = true;
    ui.unavailable.hidden = false;
    ui.unavailableCopy.textContent = message;
    ui.accountPill.textContent = state.account ? "No style access" : "Sign in required";
    ui.signinSlot.hidden = Boolean(state.account);
    if (!state.account) waitForGoogle();
  }

  function showView() {
    ui.loading.hidden = true;
    ui.unavailable.hidden = true;
    ui.view.hidden = false;
    ui.accountPill.textContent = state.testing
      ? "Owner access · Local testing"
      : `${state.account?.name || "Owner/Admin"} · Style editor`;
  }

  const foundry = {
    ...window.CarbonFrontierWikiStyle.CLASSIC,
    accentColor: "#f08c2b", accentSoftColor: "#ffc27f", linkColor: "#ffc27f",
    textColor: "#fffaf4", articleTextColor: "#e0d7ce", mutedTextColor: "#b9ada2", softTextColor: "#80766e",
    backgroundTop: "#120d09", backgroundMiddle: "#050403", backgroundBottom: "#0b0806",
    panelColor: "#f7c79d", panelOpacity: .05, panelStrongOpacity: .09,
    articleColor: "#0b0806", articleOpacity: .94, borderColor: "#f7c79d", borderOpacity: .14,
    gridSize: 88, gridOpacity: .03, glowStrength: .2, secondaryGlowStrength: .1,
    shadowOpacity: .5, articleLineHeight: 1.68, articleRadius: 22,
  };
  const midnight = {
    ...window.CarbonFrontierWikiStyle.CLASSIC,
    accentColor: "#4f83ff", accentSoftColor: "#8fb0ff", linkColor: "#8fb0ff",
    articleTextColor: "#d5dcf0", mutedTextColor: "#aeb8d0", softTextColor: "#75809a",
    backgroundTop: "#07101f", backgroundMiddle: "#02050b", backgroundBottom: "#050914",
    panelColor: "#9db8ff", articleColor: "#050914", articleOpacity: .94,
    borderColor: "#9db8ff", borderOpacity: .13, gridSize: 72, gridOpacity: .04,
    glowStrength: .2, secondaryGlowStrength: .12, shadowOpacity: .5, contentMaxWidth: 1280, articleRadius: 24,
  };

  function seedLocalStyles() {
    const now = new Date().toISOString();
    return {
      activeStyleId: "style-carbon-frontier-classic",
      styles: [
        { id: "style-carbon-frontier-classic", name: "Carbon Frontier Classic", config: clone(window.CarbonFrontierWikiStyle.CLASSIC), isActive: true, updatedAt: now },
        { id: "style-foundry-dark", name: "Foundry Dark", config: clone(foundry), isActive: false, updatedAt: now },
        { id: "style-midnight-grid", name: "Midnight Grid", config: clone(midnight), isActive: false, updatedAt: now },
      ],
    };
  }

  function localPayload() {
    let payload;
    try { payload = JSON.parse(localStorage.getItem(TESTING_KEY) || "null"); } catch { payload = null; }
    if (!payload?.styles?.length) {
      payload = seedLocalStyles();
      localStorage.setItem(TESTING_KEY, JSON.stringify(payload));
    }
    payload.styles = payload.styles.map((style) => ({
      ...style,
      config: window.CarbonFrontierWikiStyle.normalize(style.config),
      isActive: style.id === payload.activeStyleId,
    }));
    return payload;
  }

  function saveLocalPayload() {
    const payload = { activeStyleId: state.activeStyleId, styles: state.styles.map((style) => ({ ...style, isActive: style.id === state.activeStyleId })) };
    localStorage.setItem(TESTING_KEY, JSON.stringify(payload));
  }

  async function remoteRequest(body = null) {
    const response = await fetch(body ? ENDPOINT : `${ENDPOINT}?manage=1`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${state.idToken}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || `Style request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function absorbPayload(payload) {
    state.activeStyleId = payload.activeStyleId || "";
    state.styles = (payload.styles || []).map((style) => ({
      ...style,
      config: window.CarbonFrontierWikiStyle.normalize(style.config),
      isActive: style.id === payload.activeStyleId,
    }));
    if (!state.styles.some((style) => style.id === state.selectedId)) {
      state.selectedId = state.activeStyleId || state.styles[0]?.id || "";
    }
    selectStyle(state.selectedId, { keepFeedback: true });
  }

  async function loadManagement() {
    try {
      if (state.testing) {
        state.account = { email: "jb141598@gmail.com", name: "Cursor Testing Owner", idToken: "" };
        const payload = localPayload();
        showView();
        absorbPayload(payload);
        return;
      }
      if (!state.account) {
        showUnavailable("Sign in with a wiki Owner or Admin account to edit the wiki appearance.");
        return;
      }
      const payload = await remoteRequest();
      showView();
      absorbPayload(payload);
    } catch (error) {
      if (error?.status === 401) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        state.account = null;
        state.idToken = "";
        showUnavailable("Your Google sign-in expired. Sign in again with a wiki Owner or Admin account.");
        return;
      }
      showUnavailable(error?.message || "The wiki style editor could not load.");
    }
  }

  function fieldOutput(field, value) {
    if (field.type !== "range") return "";
    const formatted = Number(field.step) < 1 ? Number(value).toFixed(field.step < .01 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "") : String(value);
    return `${formatted}${field.suffix || ""}`;
  }

  function createField(field) {
    const wrapper = document.createElement("label");
    wrapper.className = `field${field.wide ? " is-wide" : ""}`;
    const label = document.createElement("span");
    label.className = "field-label";
    label.innerHTML = `${field.label}<span class="field-output" data-output-for="${field.key}"></span>`;
    wrapper.append(label);

    let input;
    let inputAlreadyPlaced = false;
    if (field.type === "toggle") {
      const box = document.createElement("span");
      box.className = "toggle-field";
      const text = document.createElement("span");
      text.textContent = field.label;
      input = document.createElement("input");
      input.type = "checkbox";
      box.append(text, input);
      wrapper.replaceChildren(box);
      inputAlreadyPlaced = true;
    } else if (field.type === "select") {
      input = document.createElement("select");
      (field.options || []).forEach((option) => {
        const item = document.createElement("option");
        item.value = String(typeof option === "object" ? option.value : option);
        item.textContent = typeof option === "object" ? option.label : option;
        input.append(item);
      });
    } else if (field.type === "color") {
      const row = document.createElement("div");
      row.className = "color-row";
      input = document.createElement("input");
      input.type = "color";
      const text = document.createElement("input");
      text.type = "text";
      text.maxLength = 7;
      text.dataset.colorTextFor = field.key;
      row.append(input, text);
      wrapper.append(row);
      inputAlreadyPlaced = true;
      text.addEventListener("input", () => {
        if (/^#[0-9a-f]{6}$/i.test(text.value)) {
          input.value = text.value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    } else {
      input = document.createElement("input");
      input.type = field.type;
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
    }
    input.dataset.configKey = field.key;
    input.dataset.fieldType = field.type;
    if (field.numeric) input.dataset.numeric = "true";
    if (!inputAlreadyPlaced) wrapper.append(input);
    input.addEventListener("input", handleConfigInput);
    input.addEventListener("change", handleConfigInput);
    return wrapper;
  }

  function renderFields() {
    ui.fields.replaceChildren();
    GROUPS.forEach((group) => {
      const section = document.createElement("section");
      section.className = "field-group";
      const heading = document.createElement("h3");
      heading.textContent = group.title;
      const copy = document.createElement("p");
      copy.textContent = group.copy;
      const grid = document.createElement("div");
      grid.className = "field-grid";
      group.fields.forEach((field) => grid.append(createField(field)));
      section.append(heading, copy, grid);
      ui.fields.append(section);
    });
  }

  function writeFields(config) {
    const normalized = window.CarbonFrontierWikiStyle.normalize(config);
    GROUPS.flatMap((group) => group.fields).forEach((field) => {
      const input = ui.fields.querySelector(`[data-config-key="${field.key}"]`);
      if (!input) return;
      const value = normalized[field.key];
      if (field.type === "toggle") input.checked = Boolean(value);
      else input.value = String(value);
      const output = ui.fields.querySelector(`[data-output-for="${field.key}"]`);
      if (output) output.textContent = fieldOutput(field, value);
      const colorText = ui.fields.querySelector(`[data-color-text-for="${field.key}"]`);
      if (colorText) colorText.value = String(value);
    });
  }

  function readFields() {
    const config = {};
    ui.fields.querySelectorAll("[data-config-key]").forEach((input) => {
      const key = input.dataset.configKey;
      if (input.dataset.fieldType === "toggle") config[key] = input.checked;
      else if (input.dataset.fieldType === "range" || input.dataset.numeric === "true") config[key] = Number(input.value);
      else config[key] = input.value;
    });
    return window.CarbonFrontierWikiStyle.normalize(config);
  }

  function handleConfigInput(event) {
    if (!state.draft) return;
    state.draft.config = readFields();
    const field = GROUPS.flatMap((group) => group.fields).find((item) => item.key === event.target.dataset.configKey);
    if (field) {
      const output = ui.fields.querySelector(`[data-output-for="${field.key}"]`);
      if (output) output.textContent = fieldOutput(field, state.draft.config[field.key]);
      const colorText = ui.fields.querySelector(`[data-color-text-for="${field.key}"]`);
      if (colorText) colorText.value = state.draft.config[field.key];
    }
    window.CarbonFrontierWikiStyle.applyPreview(ui.preview, state.draft.config);
    setFeedback("Unsaved changes.");
  }

  function renderStyles() {
    ui.list.replaceChildren();
    state.styles.forEach((style) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `style-card${style.id === state.selectedId ? " is-selected" : ""}${style.id === state.activeStyleId ? " is-active" : ""}`;
      const top = document.createElement("span");
      top.className = "style-card-top";
      const name = document.createElement("strong");
      name.textContent = style.name;
      top.append(name);
      if (style.id === state.activeStyleId) {
        const chip = document.createElement("span");
        chip.className = "active-chip";
        chip.textContent = "Active";
        top.append(chip);
      }
      const meta = document.createElement("small");
      meta.textContent = style.updatedAt ? `Updated ${new Date(style.updatedAt).toLocaleDateString()}` : "Ready to customize";
      button.append(top, meta);
      button.addEventListener("click", () => selectStyle(style.id));
      ui.list.append(button);
    });
  }

  function selectedStyle() { return state.styles.find((style) => style.id === state.selectedId) || null; }

  function selectStyle(id, { keepFeedback = false } = {}) {
    const style = state.styles.find((item) => item.id === id);
    if (!style) return;
    state.selectedId = id;
    state.draft = clone(style);
    state.draft.config = window.CarbonFrontierWikiStyle.normalize(state.draft.config);
    ui.name.value = state.draft.name;
    writeFields(state.draft.config);
    window.CarbonFrontierWikiStyle.applyPreview(ui.preview, state.draft.config);
    ui.activateButton.textContent = id === state.activeStyleId ? "Active Style" : "Make Active";
    ui.activateButton.disabled = id === state.activeStyleId || state.busy;
    ui.deleteButton.disabled = id === state.activeStyleId || state.styles.length <= 1 || state.busy;
    renderStyles();
    if (!keepFeedback) setFeedback("");
  }

  function absorbMutation(payload, message) {
    if (payload?.mutation?.styleId && payload?.styles?.some((style) => style.id === payload.mutation.styleId)) {
      state.selectedId = payload.mutation.styleId;
    }
    absorbPayload(payload);
    setFeedback(message);
  }

  async function mutate(body, message) {
    if (state.busy) return;
    setBusy(true);
    setFeedback("Saving...");
    try {
      if (state.testing) {
        const action = body.action;
        if (action === "create_style") {
          const id = randomId();
          state.styles.push({ id, name: body.name, config: window.CarbonFrontierWikiStyle.normalize(body.config), updatedAt: new Date().toISOString() });
          state.selectedId = id;
        } else if (action === "update_style") {
          const style = state.styles.find((item) => item.id === body.styleId);
          if (style) { style.name = body.name; style.config = window.CarbonFrontierWikiStyle.normalize(body.config); style.updatedAt = new Date().toISOString(); }
        } else if (action === "activate_style") {
          state.activeStyleId = body.styleId;
        } else if (action === "delete_style") {
          state.styles = state.styles.filter((item) => item.id !== body.styleId);
          state.selectedId = state.activeStyleId || state.styles[0]?.id || "";
        }
        saveLocalPayload();
        selectStyle(state.selectedId, { keepFeedback: true });
        setFeedback(message);
        return;
      }
      const payload = await remoteRequest(body);
      absorbMutation(payload, message);
    } catch (error) {
      setFeedback(error?.message || "The style change could not be saved.", true);
    } finally {
      setBusy(false);
      if (state.selectedId) selectStyle(state.selectedId, { keepFeedback: true });
    }
  }


  function uniqueStyleName(base) {
    const names = new Set(state.styles.map((style) => String(style.name || "").toLowerCase()));
    let candidate = String(base || "New Wiki Style").slice(0, 80);
    if (!names.has(candidate.toLowerCase())) return candidate;
    let index = 2;
    while (index < 100) {
      const suffix = ` ${index}`;
      candidate = `${String(base || "New Wiki Style").slice(0, 80 - suffix.length)}${suffix}`;
      if (!names.has(candidate.toLowerCase())) return candidate;
      index += 1;
    }
    return `Wiki Style ${Date.now()}`.slice(0, 80);
  }

  ui.name.addEventListener("input", () => {
    if (!state.draft) return;
    state.draft.name = ui.name.value;
    setFeedback("Unsaved changes.");
  });

  ui.saveButton.addEventListener("click", () => {
    if (!state.draft) return;
    const name = ui.name.value.trim();
    if (!name) { setFeedback("Enter a style name.", true); ui.name.focus(); return; }
    state.draft.config = readFields();
    mutate({ action: "update_style", styleId: state.draft.id, name, config: state.draft.config }, "Style saved.");
  });

  ui.activateButton.addEventListener("click", () => {
    if (!state.draft || state.draft.id === state.activeStyleId) return;
    mutate({ action: "activate_style", styleId: state.draft.id }, `${state.draft.name} is now the active wiki style.`);
  });

  ui.newButton.addEventListener("click", () => {
    const config = clone(window.CarbonFrontierWikiStyle.CLASSIC);
    mutate({ action: "create_style", name: uniqueStyleName("New Wiki Style"), config }, "New style created. Customize it and save when ready.");
  });

  ui.duplicateButton.addEventListener("click", () => {
    const source = state.draft || selectedStyle();
    if (!source) return;
    mutate({ action: "create_style", name: uniqueStyleName(`${source.name} Copy`), config: readFields() }, "Style duplicated.");
  });

  ui.deleteButton.addEventListener("click", () => {
    const style = selectedStyle();
    if (!style || style.id === state.activeStyleId) return;
    if (ui.deleteButton.dataset.armed !== style.id) {
      ui.deleteButton.dataset.armed = style.id;
      ui.deleteButton.textContent = "Confirm Delete";
      setFeedback("Click Confirm Delete to permanently remove this style.");
      return;
    }
    ui.deleteButton.dataset.armed = "";
    ui.deleteButton.textContent = "Delete Style";
    mutate({ action: "delete_style", styleId: style.id }, "Style deleted.");
  });

  ui.resetButton.addEventListener("click", () => {
    ui.deleteButton.dataset.armed = "";
    ui.deleteButton.textContent = "Delete Style";
    selectStyle(state.selectedId);
  });

  renderFields();
  state.account = state.testing ? null : loadSession();
  state.idToken = state.account?.idToken || "";
  waitForGoogle();
  loadManagement();
})();
