/* Carbon Frontier MediaWiki-compatible template source parser and safe renderer. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CarbonFrontierTemplateWikitext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const API_VERSION = 2;
  const MAX_SOURCE = 100_000;
  const MAX_EXPANSIONS = 1_000;
  const MAX_DEPTH = 20;
  const ALLOWED_TAGS = new Set([
    "A", "ARTICLE", "ASIDE", "B", "BLOCKQUOTE", "BR", "CAPTION", "CODE", "DIV", "EM",
    "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER",
    "HR", "I", "IMG", "LI", "OL", "P", "PRE", "SECTION", "SMALL", "SPAN", "STRONG",
    "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "U", "UL",
  ]);
  const ALLOWED_STYLES = new Set([
    "align-items", "align-content", "align-self", "background", "background-color", "border",
    "border-bottom", "border-bottom-color", "border-bottom-style", "border-bottom-width",
    "border-color", "border-left", "border-left-color", "border-left-style", "border-left-width",
    "border-radius", "border-right", "border-right-color", "border-right-style", "border-right-width",
    "border-style", "border-top", "border-top-color", "border-top-style", "border-top-width",
    "border-width", "bottom", "box-shadow", "box-sizing", "color", "column-gap", "display", "flex",
    "flex-basis", "flex-direction", "flex-grow", "flex-shrink", "flex-wrap", "font-family", "font-size",
    "font-style", "font-weight", "gap", "grid-template-columns", "grid-template-rows", "height",
    "justify-content", "justify-items", "left", "letter-spacing", "line-height", "margin",
    "margin-bottom", "margin-left", "margin-right", "margin-top", "max-height", "max-width",
    "min-height", "min-width", "object-fit", "opacity", "overflow", "overflow-wrap", "overflow-x",
    "overflow-y", "padding", "padding-bottom", "padding-left", "padding-right", "padding-top",
    "place-items", "position", "right", "row-gap", "text-align", "text-decoration", "text-overflow",
    "text-transform", "top", "transform", "transform-origin", "vertical-align", "white-space", "width",
    "word-break", "z-index", "-webkit-box-orient", "-webkit-line-clamp",
  ]);

  function cleanSource(value) {
    if (typeof value !== "string") throw new Error("Template source must be text.");
    if (new TextEncoder().encode(value).length > MAX_SOURCE) throw new Error("Template source must be 100 KB or smaller.");
    return value.replace(/\r\n?/g, "\n");
  }

  function normalizeName(value) {
    return String(value || "").replace(/^template\s*:/i, "").replace(/_/g, " ")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }

  function slugify(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function removeComments(source) {
    return String(source || "").replace(/<!--[\s\S]*?-->/g, "");
  }

  function transclusionSource(source) {
    const clean = removeComments(source);
    const only = [...clean.matchAll(/<onlyinclude\b[^>]*>([\s\S]*?)<\/onlyinclude\s*>/gi)];
    if (only.length) return only.map((match) => match[1]).join("");
    const include = [...clean.matchAll(/<includeonly\b[^>]*>([\s\S]*?)<\/includeonly\s*>/gi)];
    if (include.length) return include.map((match) => match[1]).join("");
    return clean.replace(/<noinclude\b[^>]*>[\s\S]*?<\/noinclude\s*>/gi, "")
      .replace(/<\/?(?:includeonly|onlyinclude)\b[^>]*>/gi, "");
  }

  function documentationSource(source) {
    return [...String(source || "").matchAll(/<noinclude\b[^>]*>([\s\S]*?)<\/noinclude\s*>/gi)]
      .map((match) => match[1]).join("\n").trim();
  }

  function validateBalance(source) {
    const stack = [];
    const clean = removeComments(source);
    for (let index = 0; index < clean.length;) {
      const next3 = clean.slice(index, index + 3);
      const next2 = clean.slice(index, index + 2);
      if (next3 === "{{{") { stack.push({ type: "parameter", index }); index += 3; continue; }
      if (next3 === "}}}" && stack.at(-1)?.type === "parameter") { stack.pop(); index += 3; continue; }
      if (next2 === "{{") { stack.push({ type: "template", index }); index += 2; continue; }
      if (next2 === "}}" && stack.at(-1)?.type === "template") { stack.pop(); index += 2; continue; }
      index += 1;
    }
    if (stack.length) {
      const item = stack.at(-1);
      const line = clean.slice(0, item.index).split("\n").length;
      throw new Error(`Line ${line}: an opening ${item.type === "parameter" ? "{{{" : "{{"} has no matching closing braces.`);
    }
    for (const tag of ["includeonly", "noinclude", "onlyinclude"]) {
      const opening = (source.match(new RegExp(`<${tag}\\b`, "gi")) || []).length;
      const closing = (source.match(new RegExp(`<\\/${tag}\\s*>`, "gi")) || []).length;
      if (opening !== closing) throw new Error(`The <${tag}> and </${tag}> tags must be paired.`);
    }
  }

  function splitTopLevel(value, delimiter = "|") {
    const parts = [];
    let current = "", templateDepth = 0, parameterDepth = 0, linkDepth = 0;
    for (let index = 0; index < value.length;) {
      const next3 = value.slice(index, index + 3);
      const next2 = value.slice(index, index + 2);
      if (next3 === "{{{") { parameterDepth += 1; current += next3; index += 3; continue; }
      if (next3 === "}}}" && parameterDepth) { parameterDepth -= 1; current += next3; index += 3; continue; }
      if (next2 === "{{") { templateDepth += 1; current += next2; index += 2; continue; }
      if (next2 === "}}" && templateDepth) { templateDepth -= 1; current += next2; index += 2; continue; }
      if (next2 === "[[") { linkDepth += 1; current += next2; index += 2; continue; }
      if (next2 === "]]" && linkDepth) { linkDepth -= 1; current += next2; index += 2; continue; }
      if (value[index] === delimiter && !templateDepth && !parameterDepth && !linkDepth) {
        parts.push(current); current = ""; index += 1; continue;
      }
      current += value[index++];
    }
    parts.push(current);
    return parts;
  }

  function topLevelEquals(value) {
    let templateDepth = 0, parameterDepth = 0, linkDepth = 0;
    for (let index = 0; index < value.length;) {
      const next3 = value.slice(index, index + 3), next2 = value.slice(index, index + 2);
      if (next3 === "{{{") { parameterDepth += 1; index += 3; continue; }
      if (next3 === "}}}" && parameterDepth) { parameterDepth -= 1; index += 3; continue; }
      if (next2 === "{{") { templateDepth += 1; index += 2; continue; }
      if (next2 === "}}" && templateDepth) { templateDepth -= 1; index += 2; continue; }
      if (next2 === "[[") { linkDepth += 1; index += 2; continue; }
      if (next2 === "]]" && linkDepth) { linkDepth -= 1; index += 2; continue; }
      if (value[index] === "=" && !templateDepth && !parameterDepth && !linkDepth) return index;
      index += 1;
    }
    return -1;
  }

  function extractPlaceholders(source) {
    const found = new Map();
    const pattern = /\{\{\{\s*([^|{}]+?)(?:\|([^{}]*?))?\}\}\}/g;
    for (const match of String(source || "").matchAll(pattern)) {
      const key = String(match[1] || "").trim().slice(0, 80);
      if (!key || found.has(key)) continue;
      const defaultValue = String(match[2] || "").trim().slice(0, 1000);
      const imageLike = /(?:image|img|file|photo|picture|icon|logo|arrowfile|plusfile)$/i.test(key) || /\.(?:gif|jpe?g|png|webp)$/i.test(defaultValue);
      found.set(key, {
        key,
        label: /^\d+$/.test(key) ? `Value ${key}` : key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        kind: imageLike ? "image" : "text",
        defaultValue: imageLike ? "" : defaultValue,
        defaultAlt: imageLike ? defaultValue : "",
      });
    }
    return [...found.values()].slice(0, 100);
  }

  function parse(source) {
    const normalized = cleanSource(source);
    validateBalance(normalized);
    return {
      version: 2,
      kind: "wikitext",
      source: normalized,
      canvas: { width: 720, height: 420, backgroundColor: "#111111" },
      elements: [],
      placeholders: extractPlaceholders(normalized),
    };
  }

  function findInnermost(source, opening, closing) {
    const stack = [];
    for (let index = 0; index < source.length;) {
      if (source.startsWith(opening, index)) { stack.push(index); index += opening.length; continue; }
      if (source.startsWith(closing, index) && stack.length) {
        return { start: stack.pop(), end: index + closing.length, innerEnd: index };
      }
      index += 1;
    }
    return null;
  }

  function expandParameters(source, values) {
    let output = source;
    for (let count = 0; count < MAX_EXPANSIONS; count += 1) {
      const block = findInnermost(output, "{{{", "}}}");
      if (!block) break;
      const inner = output.slice(block.start + 3, block.innerEnd);
      const parts = splitTopLevel(inner);
      const key = String(parts.shift() || "").trim();
      const fallback = parts.join("|");
      const replacement = Object.prototype.hasOwnProperty.call(values || {}, key) ? String(values[key] ?? "") : fallback;
      output = output.slice(0, block.start) + replacement + output.slice(block.end);
    }
    return output;
  }

  function findTemplate(options, name) {
    const wanted = normalizeName(name);
    return (options.templates || []).find((template) => [template.name, template.slug]
      .some((value) => normalizeName(value) === wanted)) || null;
  }

  function numericExpression(value) {
    const expression = String(value || "").trim();
    if (!expression || !/^[\d\s+\-*/%().]+$/.test(expression)) return "Expression error";
    const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%]/g) || [];
    let index = 0;
    function primary() {
      const token = tokens[index++];
      if (token === "(") { const result = addition(); if (tokens[index++] !== ")") throw new Error(); return result; }
      if (token === "+") return primary();
      if (token === "-") return -primary();
      const number = Number(token); if (!Number.isFinite(number)) throw new Error(); return number;
    }
    function multiply() {
      let result = primary();
      while (["*", "/", "%"].includes(tokens[index])) {
        const operator = tokens[index++], right = primary();
        result = operator === "*" ? result * right : operator === "/" ? result / right : result % right;
      }
      return result;
    }
    function addition() {
      let result = multiply();
      while (["+", "-"].includes(tokens[index])) { const operator = tokens[index++], right = multiply(); result = operator === "+" ? result + right : result - right; }
      return result;
    }
    try { const result = addition(); return index === tokens.length && Number.isFinite(result) ? String(result) : "Expression error"; }
    catch (error) { return "Expression error"; }
  }

  function parserFunction(content, options = {}) {
    const lower = content.toLowerCase();

    // MediaWiki string magic words used by imported Miraheze templates.
    if (lower.startsWith("lc:")) return content.slice(3).toLowerCase();
    if (lower.startsWith("uc:")) return content.slice(3).toUpperCase();
    if (lower.startsWith("lcfirst:")) {
      const value = content.slice(8);
      return value ? value[0].toLowerCase() + value.slice(1) : "";
    }
    if (lower.startsWith("ucfirst:")) {
      const value = content.slice(8);
      return value ? value[0].toUpperCase() + value.slice(1) : "";
    }

    if (lower.startsWith("#if:")) {
      const [condition = "", yes = "", ...rest] = splitTopLevel(content.slice(4));
      return condition.trim() ? yes : rest.join("|");
    }
    if (lower.startsWith("#ifeq:")) {
      const [left = "", right = "", yes = "", ...rest] = splitTopLevel(content.slice(6));
      return left.trim() === right.trim() ? yes : rest.join("|");
    }
    if (lower.startsWith("#ifexist:")) {
      const [target = "", yes = "", ...rest] = splitTopLevel(content.slice(9));
      const wanted = target.trim();
      if (!wanted) return rest.join("|");

      // Template existence can be checked synchronously from the templates already loaded.
      if (/^template:/i.test(wanted)) {
        return findTemplate(options, wanted.replace(/^template:/i, "")) ? yes : rest.join("|");
      }

      // File/Image existence is resolved immediately after template rendering by the
      // wiki media hydrator. Treat a non-empty file title as present here so valid
      // MediaWiki templates can emit their <img data-wiki-file-title> placeholder.
      // If the catalog really does not contain it, the hydrator shows Missing image.
      if (/^(?:file|image):/i.test(wanted)) return yes;

      // For ordinary page titles, prefer an optional page list when the caller has one.
      if (Array.isArray(options.pages)) {
        const normalized = normalizeName(wanted);
        const exists = options.pages.some((page) =>
          normalizeName(page?.title) === normalized || normalizeName(page?.slug) === normalized
        );
        return exists ? yes : rest.join("|");
      }

      // A template renderer does not synchronously own the full page index. Preserve
      // MediaWiki-compatible output rather than hiding content only because the index
      // was not supplied.
      return yes;
    }
    if (lower.startsWith("#switch:")) {
      const [wanted = "", ...cases] = splitTopLevel(content.slice(8));
      const selected = wanted.trim();
      const pendingLabels = [];
      let fallback = "";
      for (const item of cases) {
        const equals = topLevelEquals(item);
        if (equals < 0) {
          const label = item.trim();
          if (label) pendingLabels.push(label);
          continue;
        }
        const key = item.slice(0, equals).trim();
        const value = item.slice(equals + 1);
        if (key.toLowerCase() === "#default") {
          fallback = value;
          pendingLabels.length = 0;
          continue;
        }
        const labels = [...pendingLabels, key];
        pendingLabels.length = 0;
        if (labels.includes(selected)) return value;
      }
      return fallback;
    }
    if (lower.startsWith("#expr:")) return numericExpression(content.slice(6));
    return null;
  }

  function invocationValues(parts) {
    const values = {}, unnamed = [];
    for (const part of parts) {
      const equals = topLevelEquals(part);
      if (equals > 0) values[part.slice(0, equals).trim()] = part.slice(equals + 1).trim();
      else unnamed.push(part.trim());
    }
    unnamed.forEach((value, index) => { values[String(index + 1)] = value; });
    return values;
  }

  function expandTemplates(source, options, depth = 0, stack = []) {
    if (depth > MAX_DEPTH) return '<span class="cf-template-error">Template nesting limit reached</span>';
    let output = source;
    for (let count = 0; count < MAX_EXPANSIONS; count += 1) {
      const block = findInnermost(output, "{{", "}}");
      if (!block) break;
      const content = output.slice(block.start + 2, block.innerEnd).trim();
      const functionResult = parserFunction(content, options);
      let replacement;
      if (functionResult !== null) replacement = functionResult;
      else {
        const [rawName = "", ...parts] = splitTopLevel(content);
        const name = rawName.trim();
        if (name === "!") replacement = "|";
        else {
          const template = findTemplate(options, name);
          const nestedDefinition = template?.currentRevision?.definition;
          const normalizedName = normalizeName(name);
          if (!template || nestedDefinition?.kind !== "wikitext" || !nestedDefinition.source) {
            replacement = `<span class="cf-template-missing" title="The matching Carbon Frontier template has not been imported">Missing template: ${escapeHtml(name || "unnamed")}</span>`;
          } else if (stack.includes(normalizedName)) {
            replacement = `<span class="cf-template-error">Recursive template: ${escapeHtml(name)}</span>`;
          } else {
            replacement = expandSource(nestedDefinition.source, invocationValues(parts), options, depth + 1, [...stack, normalizedName]);
          }
        }
      }
      output = output.slice(0, block.start) + replacement + output.slice(block.end);
    }
    return output;
  }

  function wikiPageHref(target, options = {}) {
    const raw = String(target || "").trim().replace(/^:/, "");
    if (raw.toLowerCase() === "cf-edit-current") {
      const currentSlug = String(options.currentSlug || "").trim();
      return currentSlug && currentSlug !== "front-page"
        ? `wiki.html?page=${encodeURIComponent(currentSlug)}&edit=1`
        : "wiki.html?edit=1";
    }
    const [rawTitle = "", ...fragmentParts] = raw.split("#");
    const title = rawTitle.trim();
    if (!title) return "wiki.html";

    let slug = "";
    if (Array.isArray(options.pages)) {
      const wanted = normalizeName(title);
      const page = options.pages.find((candidate) =>
        normalizeName(candidate?.title) === wanted || normalizeName(candidate?.slug) === wanted
      );
      slug = String(page?.slug || "").trim();
    }
    if (!slug) slug = slugify(title);

    let href = `wiki.html?page=${encodeURIComponent(slug)}`;
    if (fragmentParts.length) {
      const fragment = slugify(fragmentParts.join("#"));
      if (fragment) href += `#${encodeURIComponent(fragment)}`;
    }
    return href;
  }

  function renderLinks(source, options = {}) {
    let output = source.replace(/\[\[([^\[\]]+)\]\]/g, (_match, inner) => {
      const parts = splitTopLevel(inner);
      const target = String(parts.shift() || "").trim();
      if (/^(?:File|Image):/i.test(target)) {
        const title = target.replace(/^(?:File|Image):/i, "").trim();
        const imageOptions = parts.map((part) => part.trim()).filter(Boolean);
        const caption = [...imageOptions].reverse().find((part) => !/^(?:thumb|thumbnail|frameless|frame|border|left|right|center|none|upright(?:=[\d.]+)?|\d+(?:x\d+)?px|link=.*|alt=.*|class=.*|lang=.*)$/i.test(part)) || title;
        const width = imageOptions.map((part) => part.match(/^(\d+)(?:x\d+)?px$/i)).find(Boolean)?.[1];
        const linkOption = imageOptions.find((part) => /^link\s*=/i.test(part));
        const linkTarget = linkOption === undefined ? null : linkOption.replace(/^link\s*=/i, "").trim();
        const imageHtml = `<img data-wiki-file-title="${escapeHtml(title)}" alt="${escapeHtml(caption)}"${width ? ` style="max-width:${Math.min(1600, Number(width))}px;width:100%;height:auto;"` : ""}>`;

        // MediaWiki's [[File:...|link=Page]] syntax makes the image/cell clickable.
        // An explicitly empty link= disables linking, which RecipeSlot uses for arrows and plus signs.
        if (linkTarget) {
          const href = /^https:\/\//i.test(linkTarget)
            ? linkTarget
            : wikiPageHref(linkTarget, options);
          return `<a class="cf-template-image-link" href="${escapeHtml(href)}" title="${escapeHtml(linkTarget)}" style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;max-width:100%;color:inherit;text-decoration:none;">${imageHtml}</a>`;
        }
        return imageHtml;
      }
      const label = parts.length ? parts.join("|") : target;
      return `<a href="${escapeHtml(wikiPageHref(target, options))}">${label}</a>`;
    });
    output = output.replace(/\[(https:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/g, (_match, href, label) =>
      `<a href="${escapeHtml(href)}">${label || escapeHtml(href)}</a>`);
    output = output.replace(/'''([^']+?)'''/g, "<strong>$1</strong>")
      .replace(/''([^']+?)''/g, "<em>$1</em>");
    return output;
  }

  function safeStyle(value) {
    const declarations = [];
    for (const item of String(value || "").split(";")) {
      const colon = item.indexOf(":");
      if (colon < 1) continue;
      const property = item.slice(0, colon).trim().toLowerCase();
      let content = item.slice(colon + 1).trim();
      if (!ALLOWED_STYLES.has(property) || !content || content.length > 300) continue;
      if (/[<>"']/g.test(content) || /(?:url\s*\(|expression\s*\(|javascript:|@import|-moz-binding|behavior\s*:)/i.test(content)) continue;
      if (property === "position" && !/^(?:static|relative|absolute)$/i.test(content)) content = "relative";
      if (property === "z-index") content = String(Math.max(-10, Math.min(100, Number(content) || 0)));
      declarations.push(`${property}:${content}`);
    }
    return declarations.join(";");
  }

  function sanitizeHtml(html) {
    if (typeof document === "undefined") return escapeHtml(html);
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    function clean(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 8) { child.remove(); return; }
        if (child.nodeType !== 1) return;
        if (!ALLOWED_TAGS.has(child.tagName)) { clean(child); child.replaceWith(...child.childNodes); return; }
        const kept = {};
        if (child.hasAttribute("style")) kept.style = safeStyle(child.getAttribute("style"));
        if (child.hasAttribute("class")) kept.class = String(child.getAttribute("class") || "").replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 300);
        if (child.hasAttribute("title")) kept.title = String(child.getAttribute("title") || "").slice(0, 300);
        if (child.hasAttribute("role")) kept.role = String(child.getAttribute("role") || "").replace(/[^a-z-]/g, "").slice(0, 40);
        if (child.tagName === "A") {
          const href = String(child.getAttribute("href") || "").trim();
          try {
            const parsed = new URL(href, typeof location === "undefined" ? "https://example.invalid" : location.origin);
            if (["http:", "https:", "mailto:"].includes(parsed.protocol) || href.startsWith("wiki.html")) kept.href = href;
          } catch (error) { /* Unsafe links lose their destination. */ }
          kept.rel = "noopener noreferrer";
        }
        if (child.tagName === "IMG") {
          kept.alt = String(child.getAttribute("alt") || "Wiki image").slice(0, 240);
          const fileTitle = String(child.getAttribute("data-wiki-file-title") || "").trim().slice(0, 180);
          if (fileTitle) kept["data-wiki-file-title"] = fileTitle;
          const src = String(child.getAttribute("src") || "").trim();
          if (/^(?:https:\/\/|data:image\/(?:gif|jpeg|png|webp);base64,)/i.test(src)) kept.src = src;
          kept.loading = "lazy";
        }
        [...child.attributes].forEach((attribute) => child.removeAttribute(attribute.name));
        Object.entries(kept).forEach(([name, content]) => { if (content) child.setAttribute(name, content); });
        clean(child);
      });
    }
    clean(template.content);
    return template.innerHTML;
  }

  function expandSource(source, values = {}, options = {}, depth = 0, stack = []) {
    let output = transclusionSource(source);
    output = expandParameters(output, values);
    output = expandTemplates(output, options, depth, stack);
    output = renderLinks(output, options);
    return output;
  }

  function render(source, values = {}, options = {}) {
    const normalized = cleanSource(source);
    validateBalance(normalized);
    const expanded = expandSource(normalized, values, options, 0, options.stack || []);
    return {
      html: sanitizeHtml(expanded),
      placeholders: extractPlaceholders(normalized),
      documentation: documentationSource(normalized),
    };
  }

  function px(value) { return `${Math.round(Number(value) || 0)}px`; }
  function visualTextSource(value) {
    // Escape HTML so visual text stays text, while preserving the link markup
    // inserted by the visual editor ([[Wiki page|label]] and [https://... label]).
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function visualElementSource(element) {
    const style = [
      "position:absolute", `left:${px(element.x)}`, `top:${px(element.y)}`,
      `width:${px(element.width)}`, `height:${px(element.height)}`,
      `z-index:${Math.round(Number(element.zIndex) || 1)}`, `opacity:${Number(element.opacity ?? 1)}`,
      `transform:rotate(${Number(element.rotation) || 0}deg)`, "box-sizing:border-box", "overflow:hidden",
    ];
    if (element.type === "text" || element.type === "placeholder") {
      style.push(`font-family:${element.fontFamily || "Play"}`, `font-size:${px(element.fontSize || 24)}`,
        `font-weight:${Number(element.fontWeight) >= 700 ? 700 : 400}`, `font-style:${element.fontStyle === "italic" ? "italic" : "normal"}`,
        `text-align:${element.textAlign || "left"}`, `color:${element.color || "#ffffff"}`, "white-space:pre-wrap");
      const content = element.type === "placeholder"
        ? `{{{${element.placeholderKey || "value"}|${String(element.defaultValue || "")}}}}`
        : visualTextSource(element.text || "");
      return `<div style="${style.join(";")}">${content}</div>`;
    }
    if (element.type === "image") {
      const mediaId = String(element.mediaId || "").trim();
      const directUrl = String(element.url || "").trim();
      const alt = escapeHtml(element.alt || "Template image");
      const fit = element.fit === "contain" ? "contain" : "cover";
      style.push(`border-radius:${px(element.borderRadius || 0)}`);
      if (mediaId) {
        return `<div style="${style.join(";")}">[[File:${escapeHtml(mediaId)}|frameless|${Math.max(1, Math.round(Number(element.width) || 1))}px|${alt}]]</div>`;
      }
      if (/^(?:https:\/\/|data:image\/(?:gif|jpeg|png|webp);base64,)/i.test(directUrl)) {
        return `<div style="${style.join(";")}"><img src="${escapeHtml(directUrl)}" alt="${alt}" style="width:100%;height:100%;object-fit:${fit};border-radius:${px(element.borderRadius || 0)}"></div>`;
      }
      return `<div style="${style.join(";")}"></div>`;
    }
    if (element.type === "image-placeholder") {
      style.push(`background:${element.fill || "#1b1b1e"}`, `border:${Number(element.strokeWidth) || 0}px solid ${element.stroke || "#df2531"}`, `border-radius:${px(element.borderRadius || 0)}`);
      return `<div style="${style.join(";")}">[[File:{{{${element.placeholderKey || "image"}|}}}|${escapeHtml(element.defaultAlt || "Template image")}]]</div>`;
    }
    if (element.type === "line") style.push("height:0", `border-top:${Number(element.strokeWidth) || 1}px solid ${element.stroke || "#ffffff"}`);
    else style.push(`background:${element.fill || "transparent"}`, `border:${Number(element.strokeWidth) || 0}px solid ${element.stroke || "#ffffff"}`, `border-radius:${px(element.borderRadius || 0)}`);
    return `<div style="${style.join(";")}"></div>`;
  }

  function format(definition) {
    if (definition?.kind === "wikitext" && typeof definition.source === "string") return definition.source;
    const canvas = definition?.canvas || { width: 720, height: 420, backgroundColor: "#111111" };
    const elements = (definition?.elements || []).map(visualElementSource).join("\n");
    return `<includeonly><div style="position:relative;width:${px(canvas.width || 720)};height:${px(canvas.height || 420)};background:${canvas.backgroundColor || "#111111"};overflow:hidden;box-sizing:border-box;">\n${elements}\n</div></includeonly>\n<noinclude>Created with Carbon Frontier Template Studio.</noinclude>`;
  }

  const example = `<includeonly>
<div style="display:flex;align-items:center;gap:12px;padding:16px;background:#24272b;border:2px solid #000;border-radius:16px;color:#fff;">
  <strong>{{{name|Machine Name}}}</strong>
  {{#if:{{{power|}}}|<span>Power: {{{power}}}</span>|}}
</div>
</includeonly>
<noinclude>Use this template on a wiki page and fill in name and power.</noinclude>`;

  return Object.freeze({ apiVersion: API_VERSION, parse, format, render, extractPlaceholders, transclusionSource, documentationSource, example });
});
