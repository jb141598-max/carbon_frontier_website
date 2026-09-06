(function () {
  "use strict";

  const CACHE_KEY = "carbon-frontier-wiki-style-cache-v1";
  const TESTING_KEY = "carbon-frontier-wiki-style-testing-v1";
  const ENDPOINT = "/api/wiki/style";
  const FONT_FAMILIES = new Set([
    "Play",
    "Arial",
    "Georgia",
    "Times New Roman",
    "Verdana",
    "Courier New",
  ]);
  const HEX_COLOR = /^#[0-9a-f]{6}$/i;

  const CLASSIC = Object.freeze({
    accentColor: "#df2531",
    accentSoftColor: "#ff9ba2",
    linkColor: "#ff929a",
    textColor: "#ffffff",
    articleTextColor: "#d1d1d1",
    mutedTextColor: "#b3b3b3",
    softTextColor: "#7a7a7a",
    backgroundTop: "#080808",
    backgroundMiddle: "#000000",
    backgroundBottom: "#050505",
    panelColor: "#ffffff",
    panelOpacity: 0.045,
    panelStrongOpacity: 0.075,
    articleColor: "#080808",
    articleOpacity: 0.9,
    borderColor: "#ffffff",
    borderOpacity: 0.12,
    gridEnabled: true,
    gridSize: 96,
    gridOpacity: 0.035,
    glowEnabled: true,
    glowStrength: 0.24,
    secondaryGlowStrength: 0.15,
    shadowOpacity: 0.44,
    fontFamily: "Play",
    baseFontSize: 16,
    articleLineHeight: 1.65,
    headingWeight: 700,
    contentMaxWidth: 1240,
    pagePadding: 28,
    articleRadius: 28,
    articlePadding: 48,
    linkUnderline: false,
  });

  function isTestingEnvironment() {
    const hostname = String(location.hostname || "").toLowerCase();
    const context = `${navigator.userAgent || ""} ${document.referrer || ""}`.toLowerCase();
    return location.protocol === "file:" ||
      ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
      context.includes("cursor") || context.includes("vscode") || context.includes("electron");
  }

  function color(value, fallback) {
    const candidate = String(value || "").trim().toLowerCase();
    return HEX_COLOR.test(candidate) ? candidate : fallback;
  }

  function number(value, minimum, maximum, fallback) {
    const candidate = Number(value);
    return Number.isFinite(candidate)
      ? Math.min(maximum, Math.max(minimum, candidate))
      : fallback;
  }

  function integer(value, minimum, maximum, fallback) {
    return Math.round(number(value, minimum, maximum, fallback));
  }

  function normalize(raw = {}) {
    return {
      accentColor: color(raw.accentColor, CLASSIC.accentColor),
      accentSoftColor: color(raw.accentSoftColor, CLASSIC.accentSoftColor),
      linkColor: color(raw.linkColor, CLASSIC.linkColor),
      textColor: color(raw.textColor, CLASSIC.textColor),
      articleTextColor: color(raw.articleTextColor, CLASSIC.articleTextColor),
      mutedTextColor: color(raw.mutedTextColor, CLASSIC.mutedTextColor),
      softTextColor: color(raw.softTextColor, CLASSIC.softTextColor),
      backgroundTop: color(raw.backgroundTop, CLASSIC.backgroundTop),
      backgroundMiddle: color(raw.backgroundMiddle, CLASSIC.backgroundMiddle),
      backgroundBottom: color(raw.backgroundBottom, CLASSIC.backgroundBottom),
      panelColor: color(raw.panelColor, CLASSIC.panelColor),
      panelOpacity: number(raw.panelOpacity, 0, 0.4, CLASSIC.panelOpacity),
      panelStrongOpacity: number(raw.panelStrongOpacity, 0, 0.55, CLASSIC.panelStrongOpacity),
      articleColor: color(raw.articleColor, CLASSIC.articleColor),
      articleOpacity: number(raw.articleOpacity, 0.55, 1, CLASSIC.articleOpacity),
      borderColor: color(raw.borderColor, CLASSIC.borderColor),
      borderOpacity: number(raw.borderOpacity, 0, 0.55, CLASSIC.borderOpacity),
      gridEnabled: raw.gridEnabled !== false,
      gridSize: integer(raw.gridSize, 32, 180, CLASSIC.gridSize),
      gridOpacity: number(raw.gridOpacity, 0, 0.16, CLASSIC.gridOpacity),
      glowEnabled: raw.glowEnabled !== false,
      glowStrength: number(raw.glowStrength, 0, 0.55, CLASSIC.glowStrength),
      secondaryGlowStrength: number(raw.secondaryGlowStrength, 0, 0.45, CLASSIC.secondaryGlowStrength),
      shadowOpacity: number(raw.shadowOpacity, 0, 0.8, CLASSIC.shadowOpacity),
      fontFamily: FONT_FAMILIES.has(raw.fontFamily) ? raw.fontFamily : CLASSIC.fontFamily,
      baseFontSize: integer(raw.baseFontSize, 13, 22, CLASSIC.baseFontSize),
      articleLineHeight: number(raw.articleLineHeight, 1.25, 2.1, CLASSIC.articleLineHeight),
      headingWeight: Number(raw.headingWeight) >= 700 ? 700 : 400,
      contentMaxWidth: integer(raw.contentMaxWidth, 760, 1800, CLASSIC.contentMaxWidth),
      pagePadding: integer(raw.pagePadding, 10, 64, CLASSIC.pagePadding),
      articleRadius: integer(raw.articleRadius, 0, 56, CLASSIC.articleRadius),
      articlePadding: integer(raw.articlePadding, 16, 84, CLASSIC.articlePadding),
      linkUnderline: raw.linkUnderline === true,
    };
  }

  function hexRgb(hex) {
    const normalized = color(hex, "#000000").slice(1);
    return [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16));
  }

  function rgba(hex, alpha) {
    const [red, green, blue] = hexRgb(hex);
    return `rgba(${red}, ${green}, ${blue}, ${Number(alpha).toFixed(3)})`;
  }

  function fontStack(fontFamily) {
    if (fontFamily === "Play") return '"Play", sans-serif';
    if (fontFamily === "Times New Roman") return '"Times New Roman", serif';
    if (fontFamily === "Courier New") return '"Courier New", monospace';
    if (fontFamily === "Georgia") return "Georgia, serif";
    return `${fontFamily}, sans-serif`;
  }

  function variableMap(raw) {
    const config = normalize(raw);
    return {
      "--cf-red": config.accentColor,
      "--cf-red-45": rgba(config.accentColor, 0.45),
      "--cf-red-65": rgba(config.accentColor, 0.65),
      "--cf-white": config.textColor,
      "--cf-muted": config.mutedTextColor,
      "--cf-soft": config.softTextColor,
      "--cf-panel": rgba(config.panelColor, config.panelOpacity),
      "--cf-panel-strong": rgba(config.panelColor, config.panelStrongOpacity),
      "--cf-border": rgba(config.borderColor, config.borderOpacity),
      "--cf-shadow": `0 24px 68px rgba(0, 0, 0, ${config.shadowOpacity})`,
      "--cf-wiki-link": config.linkColor,
      "--cf-wiki-article-text": config.articleTextColor,
      "--cf-wiki-article": rgba(config.articleColor, config.articleOpacity),
      "--cf-wiki-font": fontStack(config.fontFamily),
    };
  }

  function applyVariables(element, raw) {
    Object.entries(variableMap(raw)).forEach(([name, value]) => element.style.setProperty(name, value));
  }

  function runtimeCss(raw) {
    const config = normalize(raw);
    const glowOne = config.glowEnabled ? rgba(config.accentColor, config.glowStrength) : "transparent";
    const glowTwo = config.glowEnabled
      ? rgba(config.accentColor, config.secondaryGlowStrength)
      : "transparent";
    const gridLine = config.gridEnabled ? rgba(config.borderColor, config.gridOpacity) : "transparent";
    return `
      body {
        color: ${config.textColor};
        font-family: ${fontStack(config.fontFamily)};
        font-size: ${config.baseFontSize}px;
        background:
          radial-gradient(circle at top left, ${glowOne}, transparent 31%),
          radial-gradient(circle at 88% 10%, ${glowTwo}, transparent 25%),
          linear-gradient(180deg, ${config.backgroundTop} 0%, ${config.backgroundMiddle} 46%, ${config.backgroundBottom} 100%);
      }
      .page-shell { padding: ${config.pagePadding}px; }
      .page-shell::before {
        background-image:
          linear-gradient(${gridLine} 1px, transparent 1px),
          linear-gradient(90deg, ${gridLine} 1px, transparent 1px);
        background-size: ${config.gridSize}px ${config.gridSize}px;
      }
      .content { width: min(${config.contentMaxWidth}px, 100%); }
      .article-surface {
        border-radius: ${config.articleRadius}px;
        background: ${rgba(config.articleColor, config.articleOpacity)};
      }
      .article-content { padding: ${config.articlePadding}px; }
      .article-content p,
      .article-content li { color: ${config.articleTextColor}; line-height: ${config.articleLineHeight}; }
      .article-title,
      .article-content h1,
      .article-content h2,
      .article-content h3,
      .article-content h4,
      .article-content h5,
      .article-content h6 { font-weight: ${config.headingWeight}; }
      .article-content a,
      .article-content a:visited {
        color: ${config.linkColor};
        text-decoration: ${config.linkUnderline ? "underline" : "none"};
        text-underline-offset: 3px;
      }
      .article-content a:hover,
      .article-content a:focus-visible { color: ${config.accentSoftColor}; }
      .article-breadcrumb,
      .eyebrow { color: ${config.accentSoftColor}; }
      .wiki-template-wikitext,
      .article-content table { font-family: ${fontStack(config.fontFamily)}; }
    `;
  }

  function apply(raw) {
    const config = normalize(raw);
    applyVariables(document.documentElement, config);
    let style = document.getElementById("cf-wiki-style-runtime");
    if (!style) {
      style = document.createElement("style");
      style.id = "cf-wiki-style-runtime";
      document.head.append(style);
    }
    style.textContent = runtimeCss(config);
    document.documentElement.dataset.wikiStyleApplied = "true";
    return config;
  }

  function applyPreview(element, raw) {
    const config = normalize(raw);
    applyVariables(element, config);
    element.style.setProperty("--preview-accent", config.accentColor);
    element.style.setProperty("--preview-accent-soft", config.accentSoftColor);
    element.style.setProperty("--preview-link", config.linkColor);
    element.style.setProperty("--preview-text", config.textColor);
    element.style.setProperty("--preview-article-text", config.articleTextColor);
    element.style.setProperty("--preview-muted", config.mutedTextColor);
    element.style.setProperty("--preview-soft", config.softTextColor);
    element.style.setProperty("--preview-border", rgba(config.borderColor, config.borderOpacity));
    element.style.setProperty("--preview-article", rgba(config.articleColor, config.articleOpacity));
    element.style.setProperty("--preview-panel", rgba(config.panelColor, config.panelOpacity));
    element.style.setProperty("--preview-shadow", `0 24px 68px rgba(0,0,0,${config.shadowOpacity})`);
    element.style.setProperty("--preview-radius", `${config.articleRadius}px`);
    element.style.setProperty("--preview-padding", `${Math.max(16, Math.round(config.articlePadding * 0.65))}px`);
    element.style.setProperty("--preview-font", fontStack(config.fontFamily));
    element.style.setProperty("--preview-font-size", `${config.baseFontSize}px`);
    element.style.setProperty("--preview-line-height", String(config.articleLineHeight));
    element.style.setProperty("--preview-heading-weight", String(config.headingWeight));
    element.style.setProperty("--preview-link-decoration", config.linkUnderline ? "underline" : "none");
    const glowOne = config.glowEnabled ? rgba(config.accentColor, config.glowStrength) : "transparent";
    const glowTwo = config.glowEnabled
      ? rgba(config.accentColor, config.secondaryGlowStrength)
      : "transparent";
    element.style.background = `radial-gradient(circle at top left, ${glowOne}, transparent 35%), radial-gradient(circle at 90% 5%, ${glowTwo}, transparent 30%), linear-gradient(180deg, ${config.backgroundTop}, ${config.backgroundMiddle} 50%, ${config.backgroundBottom})`;
    const gridLine = config.gridEnabled ? rgba(config.borderColor, config.gridOpacity) : "transparent";
    element.style.setProperty("--preview-grid-line", gridLine);
    element.style.setProperty("--preview-grid-size", `${config.gridSize}px`);
    return config;
  }

  function readJson(storage, key) {
    try { return JSON.parse(storage.getItem(key) || "null"); }
    catch { return null; }
  }

  function writeJson(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); }
    catch { /* cache is optional */ }
  }

  function cachedStyle() {
    const testing = isTestingEnvironment();
    if (testing) {
      const local = readJson(localStorage, TESTING_KEY);
      const active = local?.styles?.find((style) => style.id === local.activeStyleId);
      if (active?.config) return active;
    }
    return readJson(localStorage, CACHE_KEY);
  }

  async function refresh() {
    if (isTestingEnvironment()) {
      const local = cachedStyle();
      if (local?.config) apply(local.config);
      else apply(CLASSIC);
      return local || { id: "style-carbon-frontier-classic", name: "Carbon Frontier Classic", config: CLASSIC };
    }
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.style?.config) throw new Error(payload?.error || "Style unavailable.");
      writeJson(localStorage, CACHE_KEY, payload.style);
      apply(payload.style.config);
      return payload.style;
    } catch (error) {
      const cached = cachedStyle();
      apply(cached?.config || CLASSIC);
      return cached || { id: "style-carbon-frontier-classic", name: "Carbon Frontier Classic", config: CLASSIC };
    }
  }

  const api = Object.freeze({
    CLASSIC,
    CACHE_KEY,
    TESTING_KEY,
    normalize,
    rgba,
    apply,
    applyPreview,
    refresh,
    isTestingEnvironment,
  });
  window.CarbonFrontierWikiStyle = api;

  if (!document.body?.hasAttribute("data-wiki-style-editor")) {
    const cached = cachedStyle();
    apply(cached?.config || CLASSIC);
    refresh();
  }
})();
