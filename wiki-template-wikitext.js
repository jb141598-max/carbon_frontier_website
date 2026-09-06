/* Carbon Frontier Template Wikitext: a safe, declarative template-canvas format. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CarbonFrontierTemplateWikitext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TYPES = new Map([
    ["text", "text"],
    ["placeholder", "placeholder"],
    ["imageplaceholder", "image-placeholder"],
    ["image-placeholder", "image-placeholder"],
    ["shape", "shape"],
    ["frame", "frame"],
    ["line", "line"],
    ["image", "image"],
  ]);
  const FONTS = new Set(["Play", "Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"]);
  const SHAPES = new Set(["rectangle", "rounded", "ellipse", "triangle", "diamond"]);
  const ALIGNS = new Set(["left", "center", "right"]);
  const FITS = new Set(["cover", "contain"]);
  const MAX_SOURCE = 100_000;
  const MAX_ELEMENTS = 100;

  function fail(line, message) {
    throw new Error(`Line ${line}: ${message}`);
  }

  function splitEscaped(value, delimiter) {
    const parts = [];
    let current = "";
    let escaped = false;
    for (const character of String(value || "")) {
      if (escaped) {
        current += `\\${character}`;
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === delimiter) {
        parts.push(current);
        current = "";
      } else {
        current += character;
      }
    }
    if (escaped) current += "\\";
    parts.push(current);
    return parts;
  }

  function decode(value) {
    let result = "";
    let escaped = false;
    for (const character of String(value || "")) {
      if (!escaped && character === "\\") {
        escaped = true;
        continue;
      }
      if (escaped && character === "n") result += "\n";
      else result += character;
      escaped = false;
    }
    if (escaped) result += "\\";
    return result;
  }

  function encode(value) {
    return String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\|/g, "\\|");
  }

  function parameters(raw, line) {
    const result = Object.create(null);
    for (const item of splitEscaped(raw, "|").map((part) => part.trim()).filter(Boolean)) {
      const equals = item.indexOf("=");
      if (equals < 1) fail(line, `Use name=value inside template directives; “${decode(item)}” is incomplete.`);
      const name = item.slice(0, equals).trim().toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(line, `“${name}” is not a valid property name.`);
      result[name] = decode(item.slice(equals + 1).trim());
    }
    return result;
  }

  function number(params, name, fallback, minimum, maximum, line) {
    if (params[name] === undefined || params[name] === "") return fallback;
    const value = Number(params[name]);
    if (!Number.isFinite(value)) fail(line, `${name} must be a number.`);
    return Math.min(maximum, Math.max(minimum, value));
  }

  function choice(params, name, allowed, fallback, line) {
    if (params[name] === undefined || params[name] === "") return fallback;
    if (!allowed.has(params[name])) fail(line, `${name} must be one of: ${[...allowed].join(", ")}.`);
    return params[name];
  }

  function color(params, name, fallback, line) {
    if (params[name] === undefined || params[name] === "") return fallback;
    const value = params[name].toLowerCase();
    if (value !== "transparent" && !/^#[0-9a-f]{6}$/.test(value)) fail(line, `${name} must be a six-digit hex color or transparent.`);
    return value;
  }

  function cleanKey(value, fallback) {
    const key = String(value || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
    return key || fallback;
  }

  function common(params, type, index, line) {
    return {
      id: String(params.id || `${type}-${index + 1}`).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || `${type}-${index + 1}`,
      type,
      x: number(params, "x", 30, -1600, 3200, line),
      y: number(params, "y", 30, -1600, 3200, line),
      width: number(params, "width", 180, 8, 3200, line),
      height: number(params, "height", type === "line" ? 8 : 80, 8, 3200, line),
      rotation: number(params, "rotation", 0, -360, 360, line),
      zIndex: Math.round(number(params, "z", index + 1, -1000, 1000, line)),
      opacity: number(params, "opacity", 1, 0.05, 1, line),
    };
  }

  function textStyle(params, line) {
    const font = params.font || "Play";
    if (!FONTS.has(font)) fail(line, `font must be one of: ${[...FONTS].join(", ")}.`);
    return {
      fontFamily: font,
      fontSize: number(params, "size", 24, 8, 144, line),
      fontWeight: number(params, "weight", 400, 400, 700, line) >= 700 ? 700 : 400,
      fontStyle: params.style === "italic" ? "italic" : "normal",
      textAlign: choice(params, "align", ALIGNS, "left", line),
      color: color(params, "color", "#ffffff", line),
    };
  }

  function elementFrom(name, params, index, line) {
    const type = TYPES.get(name.toLowerCase());
    if (!type) fail(line, `Unknown directive “${name}”.`);
    const element = common(params, type, index, line);
    if (type === "text") Object.assign(element, textStyle(params, line), { text: String(params.text || "Text").slice(0, 1000) });
    else if (type === "placeholder") Object.assign(element, textStyle(params, line), {
      placeholderKey: cleanKey(params.key, `value_${index + 1}`),
      defaultValue: String(params.default || "Placeholder text").slice(0, 500),
    });
    else if (type === "line") Object.assign(element, {
      stroke: color(params, "stroke", "#ffffff", line),
      strokeWidth: number(params, "stroke-width", 3, 1, 24, line),
    });
    else if (type === "image") Object.assign(element, {
      mediaId: String(params.media || "").slice(0, 100),
      url: /^https:\/\//i.test(params.url || "") ? String(params.url).slice(0, 2000) : "",
      alt: String(params.alt || "Template image").slice(0, 240),
      fit: choice(params, "fit", FITS, "cover", line),
      borderRadius: number(params, "radius", 0, 0, 200, line),
    });
    else if (type === "image-placeholder") Object.assign(element, {
      placeholderKey: cleanKey(params.key, `image_${index + 1}`),
      defaultAlt: String(params.alt || "Template image").slice(0, 240),
      fit: choice(params, "fit", FITS, "cover", line),
      fill: color(params, "fill", "#1b1b1e", line),
      stroke: color(params, "stroke", "#df2531", line),
      strokeWidth: number(params, "stroke-width", 2, 0, 24, line),
      borderRadius: number(params, "radius", 18, 0, 200, line),
    });
    else Object.assign(element, {
      shape: type === "frame" ? "rounded" : choice(params, "kind", SHAPES, "rectangle", line),
      fill: color(params, "fill", type === "frame" ? "transparent" : "#df2531", line),
      stroke: color(params, "stroke", "#ffffff", line),
      strokeWidth: number(params, "stroke-width", type === "frame" ? 3 : 1, 0, 24, line),
      borderRadius: number(params, "radius", type === "frame" ? 16 : 8, 0, 200, line),
    });
    return element;
  }

  function parse(source) {
    if (typeof source !== "string" || source.length > MAX_SOURCE) throw new Error("Template Wikitext must be 100,000 characters or fewer.");
    const withoutComments = source.replace(/<!--[^]*?-->/g, (comment) => "\n".repeat((comment.match(/\n/g) || []).length));
    const definition = { version: 1, canvas: { width: 720, height: 420, backgroundColor: "#111111" }, elements: [] };
    let sawCanvas = false;
    const usedIds = new Set();
    withoutComments.split(/\r?\n/).forEach((raw, index) => {
      const lineNumber = index + 1;
      const line = raw.trim();
      if (!line) return;
      const match = line.match(/^\{\{\s*([A-Za-z-]+)\s*(?:\|([^]*))?\}\}$/);
      if (!match) fail(lineNumber, "Each line must be one complete {{Directive|name=value}} block.");
      const params = parameters(match[2] || "", lineNumber);
      if (match[1].toLowerCase() === "canvas") {
        if (sawCanvas) fail(lineNumber, "Only one Canvas directive is allowed.");
        sawCanvas = true;
        definition.canvas = {
          width: Math.round(number(params, "width", 720, 240, 1600, lineNumber)),
          height: Math.round(number(params, "height", 420, 120, 1600, lineNumber)),
          backgroundColor: color(params, "background", "#111111", lineNumber),
        };
        return;
      }
      if (definition.elements.length >= MAX_ELEMENTS) fail(lineNumber, `Templates can contain at most ${MAX_ELEMENTS} objects.`);
      const element = elementFrom(match[1], params, definition.elements.length, lineNumber);
      let id = element.id;
      let suffix = 2;
      while (usedIds.has(id)) id = `${element.id}-${suffix++}`;
      element.id = id;
      usedIds.add(id);
      definition.elements.push(element);
    });
    return definition;
  }

  function property(name, value) {
    return `${name}=${encode(value)}`;
  }

  function commonProperties(element) {
    return [
      property("id", element.id), property("x", element.x), property("y", element.y),
      property("width", element.width), property("height", element.height),
      property("rotation", element.rotation || 0), property("z", element.zIndex || 0),
      property("opacity", element.opacity ?? 1),
    ];
  }

  function textProperties(element) {
    return [
      property("font", element.fontFamily || "Play"), property("size", element.fontSize || 24),
      property("weight", element.fontWeight || 400), property("style", element.fontStyle || "normal"),
      property("align", element.textAlign || "left"), property("color", element.color || "#ffffff"),
    ];
  }

  function format(definition) {
    const canvas = definition?.canvas || {};
    const lines = [
      "<!-- Carbon Frontier Template Wikitext · one safe directive per line -->",
      `{{Canvas|${property("width", canvas.width || 720)}|${property("height", canvas.height || 420)}|${property("background", canvas.backgroundColor || "#111111")}}}`,
      "",
    ];
    for (const element of definition?.elements || []) {
      const common = commonProperties(element);
      let directive = "Shape";
      let specific = [];
      if (element.type === "text") { directive = "Text"; specific = [...textProperties(element), property("text", element.text || "")]; }
      else if (element.type === "placeholder") { directive = "Placeholder"; specific = [...textProperties(element), property("key", element.placeholderKey || "value"), property("default", element.defaultValue || "")]; }
      else if (element.type === "image-placeholder") { directive = "ImagePlaceholder"; specific = [property("key", element.placeholderKey || "image"), property("alt", element.defaultAlt || "Template image"), property("fit", element.fit || "cover"), property("fill", element.fill || "#1b1b1e"), property("stroke", element.stroke || "#df2531"), property("stroke-width", element.strokeWidth ?? 2), property("radius", element.borderRadius ?? 18)]; }
      else if (element.type === "frame") { directive = "Frame"; specific = [property("fill", element.fill || "transparent"), property("stroke", element.stroke || "#ffffff"), property("stroke-width", element.strokeWidth ?? 3), property("radius", element.borderRadius ?? 16)]; }
      else if (element.type === "line") { directive = "Line"; specific = [property("stroke", element.stroke || "#ffffff"), property("stroke-width", element.strokeWidth ?? 3)]; }
      else if (element.type === "image") { directive = "Image"; specific = [property("media", element.mediaId || ""), property("url", element.url || ""), property("alt", element.alt || "Template image"), property("fit", element.fit || "cover"), property("radius", element.borderRadius ?? 0)]; }
      else { specific = [property("kind", element.shape || "rectangle"), property("fill", element.fill || "#df2531"), property("stroke", element.stroke || "#ffffff"), property("stroke-width", element.strokeWidth ?? 1), property("radius", element.borderRadius ?? 8)]; }
      lines.push(`{{${directive}|${[...common, ...specific].join("|")}}}`);
    }
    return lines.join("\n");
  }

  const example = `{{Canvas|width=420|height=300|background=#111111}}
{{Frame|id=card|x=8|y=8|width=404|height=284|fill=#171717|stroke=#df2531|stroke-width=3|radius=22}}
{{Text|id=heading|x=28|y=26|width=360|height=44|font=Play|size=30|weight=700|color=#ffffff|text=MACHINE}}
{{Placeholder|id=name|x=28|y=92|width=360|height=44|key=machine_name|default=Machine Name|font=Play|size=24|color=#ffffff}}
{{ImagePlaceholder|id=image|x=28|y=154|width=160|height=110|key=machine_image|alt=Machine image|fit=cover|fill=#1b1b1e|stroke=#df2531|stroke-width=2|radius=18}}`;

  return Object.freeze({ parse, format, example });
});
