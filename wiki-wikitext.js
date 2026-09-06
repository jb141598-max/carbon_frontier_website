/* Carbon Frontier's supported wikitext dialect. No remote parsing or executable HTML. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CarbonFrontierWikitext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const literal = (value) => escape(value).replace(/['\[\]{}|=*#!]/g, char => "&#" + char.charCodeAt(0) + ";");
  const slugify = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  const fonts = ["Play", "Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"];
  const normalizeName = (value) => slugify(String(value || "").replace(/^Template:/i, ""));
  function decode(value) {
    return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code) => {
      if (code[0] !== "#") return ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\u00a0"})[code.toLowerCase()] || match;
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2),16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd";
    });
  }
  function pageHref(target, pages = []) {
    const [name, ...fragment] = decode(target).split("#");
    const title = name.replace(/_/g, " ").trim();
    const known = pages.find((page) => page.title?.toLowerCase() === title.toLowerCase() || page.slug === title);
    const slug = known?.slug || (title ? slugify(title) : "");
    return (slug ? "wiki.html?page=" + encodeURIComponent(slug) : "") + (fragment.length ? "#" + encodeURIComponent(slugify(fragment.join("#"))) : "");
  }

  // Split delimiters only outside links, template calls, and nowiki spans.
  function splitOutside(text, delimiter) {
    const result = []; let start = 0, brackets = 0, braces = 0;
    for (let i = 0; i < text.length; i++) {
      const nowiki = text.slice(i).match(/^<nowiki>([\s\S]*?)<\/nowiki>/i);
      if (nowiki) { i += nowiki[0].length - 1; continue; }
      if (text.startsWith("[[",i)) { brackets++; i++; continue; }
      if (text.startsWith("]]",i)) { brackets--; i++; continue; }
      if (text.startsWith("{{",i)) { braces++; i++; continue; }
      if (text.startsWith("}}",i)) { braces--; i++; continue; }
      if (!brackets && !braces && text.startsWith(delimiter,i)) { result.push(text.slice(start,i)); i += delimiter.length - 1; start = i + 1; }
    }
    result.push(text.slice(start)); return result;
  }

  function inline(text, context = {}, depth = 0) {
    if (depth > 20) throw new Error("Formatting is nested too deeply.");
    text = String(text || ""); let html = "", i = 0;
    while (i < text.length) {
      const rest = text.slice(i); let match;
      if ((match = rest.match(/^<nowiki>([\s\S]*?)<\/nowiki>/i))) html += escape(match[1]);
      else if ((match = rest.match(/^<nowiki\s*\/>/i))) { /* empty escape */ }
      else if ((match = rest.match(/^<!--([\s\S]*?)-->/))) { /* source is retained with the revision */ }
      else if ((match = rest.match(/^<br\s*\/?\s*>/i))) html += "<br>";
      else if ((match = rest.match(/^\[\[([^\]\n]+)\]\]/))) {
        const parts = splitOutside(match[1], "|"); const target = parts.shift();
        if (/^(?:File|Image):/i.test(target)) throw new Error("Put each image on its own line.");
        if (/^Category:/i.test(target)) throw new Error("Category assignment syntax is not supported in this editor yet. Use [[:Category:Name]] for a normal link.");
        html += '<a href="' + escape(pageHref(target.replace(/^:/,""),context.pages)) + '">' + inline(parts.length ? parts.join("|") : target.replace(/^:/,""),context,depth+1) + "</a>";
      } else if ((match = rest.match(/^\[((?:https?:\/\/|mailto:)[^\s\]]+)(?:\s+([^\]]*))?\]/i))) {
        html += '<a href="' + escape(decode(match[1])) + '" rel="noopener noreferrer">' + inline(match[2] || match[1],context,depth+1) + "</a>";
      } else if ((match = rest.match(/^'''''([\s\S]+?)'''''/))) html += "<b><i>" + inline(match[1],context,depth+1) + "</i></b>";
      else if ((match = rest.match(/^'''([\s\S]+?)'''/))) html += "<b>" + inline(match[1],context,depth+1) + "</b>";
      else if ((match = rest.match(/^''([\s\S]+?)''/))) html += "<i>" + inline(match[1],context,depth+1) + "</i>";
      else if ((match = rest.match(/^<(b|strong|i|em|u|s|code|sub|sup)>([\s\S]*?)<\/\1>/i))) {
        const tag = match[1].toLowerCase(); html += "<" + tag + ">" + (tag === "code" ? escape(decode(match[2])) : inline(match[2],context,depth+1)) + "</" + tag + ">";
      } else if ((match = rest.match(/^<font\s+face="([^"]+)">([\s\S]*?)<\/font>/i))) {
        if (!fonts.includes(match[1])) throw new Error("That font is not supported. Choose a font from the visual toolbar.");
        html += '<font face="' + match[1] + '">' + inline(match[2],context,depth+1) + "</font>";
      } else if ((match = rest.match(/^&(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/i))) html += escape(decode(match[0]));
      else if (rest.startsWith("{{")) throw new Error("Put each template on its own line. Nested templates and parser functions are not supported.");
      else if (rest.startsWith("[[")) throw new Error("An internal link is missing its closing ]].");
      else if (/^<\/?[a-z!]/i.test(rest)) throw new Error("Unsupported or unclosed HTML tag. Use <nowiki>…</nowiki> to display it as text.");
      else { html += escape(text[i]); i++; continue; }
      i += match[0].length;
    }
    return html;
  }
  function textFromHtml(html) { return decode(String(html || "").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<[^>]+>/g,"")); }
  const formatted = (text, context) => { const html = inline(text, context); return {html, text: textFromHtml(html)}; };

  function references(content) {
    const result = Object.create(null);
    (content?.blocks || []).forEach((block,index) => { result[block.id || "cf-block-" + (index+1)] = copy({...block, id:block.id || "cf-block-" + (index+1)}); });
    return result;
  }
  function templateBlock(source, context) {
    const parts = splitOutside(source.slice(2,-2), "|"); const name = decode(parts.shift().trim());
    if (normalizeName(name) === "cfblock") {
      const id = parts.join("|").trim(); const saved = context.preserved?.[id];
      if (!saved) throw new Error("Visual block " + id + " could not be found. Keep its original CFBlock marker.");
      return copy(saved);
    }
    const key = normalizeName(name);
    const ref = parts.find(part => part.trim().startsWith("cf-ref="))?.trim().slice(7);
    const referenced = context.preserved?.[ref];
    const original = referenced?.type === "template" && normalizeName(referenced.templateSlug) === key ? referenced
      : Object.values(context.preserved || {}).find((b) => b.type === "template" && normalizeName(b.templateSlug) === key);
    const template = (context.templates || []).find((t) => normalizeName(t.name) === key || normalizeName(t.slug) === key);
    if (!template && !original) throw new Error('Template "' + name + '" does not exist. Create it in Template Studio first.');
    let hasPlacement = Boolean(original && (
      original.layout !== undefined || original.widthPercent !== undefined || original.scale !== undefined ||
      original.fullWidth !== undefined || original.baseWidthPercent !== undefined
    ));
    let layout = ["inline","wrap-left","wrap-right","break","behind","front"].includes(original?.layout) ? original.layout : "wrap-right";
    let widthPercent = Math.min(100, Math.max(10, Number(original?.widthPercent) || 46));
    let baseWidthPercent = Math.min(100, Math.max(10, Number(original?.baseWidthPercent) || widthPercent || 46));
    let scale = Math.min(3, Math.max(0.25, Number(original?.scale) || 1));
    let fullWidth = original?.fullWidth === true;
    let xPercent = Math.min(85, Math.max(0, Number(original?.xPercent) || 0));
    let yPixels = Math.min(5000, Math.max(0, Number(original?.yPixels) || 0));
    const values = Object.create(null);
    for (const part of parts) {
      const option = part.trim();
      if (option.startsWith("cf-ref=")) continue;
      if (option.startsWith("cf-object-layout=")) {
        hasPlacement = true;
        const candidate = option.slice(17);
        if (["inline","wrap-left","wrap-right","break","behind","front"].includes(candidate)) layout = candidate;
        continue;
      }
      if (option.startsWith("cf-object-width=")) { hasPlacement = true; widthPercent = Math.min(100,Math.max(10,Number(option.slice(16)) || 46)); continue; }
      if (option.startsWith("cf-object-base-width=")) { hasPlacement = true; baseWidthPercent = Math.min(100,Math.max(10,Number(option.slice(21)) || 46)); continue; }
      if (option.startsWith("cf-object-scale=")) { hasPlacement = true; scale = Math.min(3,Math.max(0.25,Number(option.slice(16)) || 1)); continue; }
      if (option.startsWith("cf-object-full-width=")) { hasPlacement = true; fullWidth = ["1","true","yes"].includes(option.slice(21).trim().toLowerCase()); continue; }
      if (option.startsWith("cf-object-x=")) { hasPlacement = true; xPercent = Math.min(85,Math.max(0,Number(option.slice(12)) || 0)); continue; }
      if (option.startsWith("cf-object-y=")) { hasPlacement = true; yPixels = Math.min(5000,Math.max(0,Number(option.slice(12)) || 0)); continue; }
      const eq = part.indexOf("=");
      if (eq < 1) throw new Error("Use named template values, such as machine_name=Coal Drill.");
      const param = part.slice(0,eq).trim(); if (!/^[a-zA-Z0-9_-]{1,60}$/.test(param)) throw new Error("Use letters, numbers, or underscores for a placeholder name.");
      const value = part.slice(eq+1).trim();
      if (/\{\{/.test(value)) throw new Error("Nested templates are not supported. Use plain text for placeholder values.");
      if (value.length > 1000) throw new Error("Template values must be 1,000 characters or fewer.");
      values[param] = decode(value.replace(/<nowiki>([\s\S]*?)<\/nowiki>/gi, "$1"));
    }
    const result = {...(original ? copy(original) : {}),type:"template", templateId:original?.templateId || template.id, templateSlug:original?.templateSlug || template.slug,
      templateRevisionId:original?.templateRevisionId || template?.currentRevision?.id || "", values,
      snapshot:copy(original?.snapshot || template?.currentRevision?.definition || null)};
    if (hasPlacement) Object.assign(result,{layout,widthPercent,baseWidthPercent,scale,fullWidth,xPercent,yPixels});
    return result;
  }
  function imageBlock(source, context) {
    const parts = splitOutside(source.slice(2,-2),"|"); const target = decode(parts.shift().replace(/^(?:File|Image):/i,""));
    const reference = parts.find((p) => p.trim().startsWith("cf-ref="))?.trim().slice(7);
    const original = context.preserved?.[reference];
    const block = original?.type === "image" ? copy(original) : {type:"image", mediaId:"", url:"", alt:"", caption:"", layout:"wrap-right", widthPercent:46, xPercent:0, yPixels:0};
    if (/^https:\/\//i.test(target)) { block.url = target; block.mediaId = original?.url === target ? original.mediaId : ""; }
    else { block.mediaId = target; if (original?.mediaId !== target) block.url = ""; }
    if (!target || (/^[a-z]+:/i.test(target) && !/^https:/i.test(target))) throw new Error("Images require an uploaded media ID or an HTTPS image URL.");
    block.caption = "";
    for (const part of parts) {
      const option = part.trim();
      if (option.startsWith("cf-ref=")) continue;
      if (["thumb","thumbnail","frame","frameless"].includes(option)) continue;
      if (option.startsWith("alt=")) block.alt = decode(option.slice(4));
      else if (/^\d+(?:\.\d+)?%$/.test(option)) block.widthPercent = Math.min(100,Math.max(20,parseFloat(option)));
      else if (["left","right","center","none","inline"].includes(option)) block.layout = ({left:"wrap-left",right:"wrap-right",center:"break",none:"break",inline:"inline"})[option];
      else if (/^cf-layout=(behind|front)$/.test(option)) block.layout = option.slice(10);
      else if (/^\d+px$/.test(option)) throw new Error("Use a percentage width for wiki images, such as 60%.");
      else block.caption = decode(option);
    }
    return block;
  }

  function parse(source, context = {}) {
    if (typeof source !== "string" || source.length > 200000) throw new Error("Wikitext must be 200,000 characters or fewer.");
    const lines = source.replace(/\r\n?/g,"\n").split("\n"); const blocks = []; let i = 0;
    const reservedIds = new Set(Object.keys(context.preserved || {})), usedIds = new Set();
    let nextId = 1;
    const push = (block) => {
      let id = block.id;
      if (!id || usedIds.has(id)) {
        do { id = "wt-block-" + nextId++; } while (reservedIds.has(id) || usedIds.has(id));
      }
      usedIds.add(id); blocks.push({...block,id});
    };
    const special = (line) => /^(?:={1,6}[^=]|[*#]|----|\{\||\{\{|\[\[(?:File|Image):|<(?:pre|blockquote)>|<!--| )/i.test(line);
    const collect = (end, label) => {
      const result = [lines[i++]];
      while (!end.test(result.join("\n")) && i < lines.length) result.push(lines[i++]);
      if (!end.test(result.join("\n"))) throw new Error(label + " is missing its closing marker.");
      return result.join("\n");
    };
    while (i < lines.length) {
      const start = i; const line = lines[i]; let match;
      try {
        if (!line.trim()) { i++; continue; }
        if (line.startsWith("<!--")) {
          const comment = collect(/-->\s*$/, "Comment");
          push({type:"comment", text:comment.slice(4,comment.lastIndexOf("-->"))});
        } else if (/^<pre>/i.test(line)) {
          const raw = collect(/<\/pre>\s*$/i,"Preformatted block"); push({type:"preformatted",text:decode(raw.replace(/^<pre>/i,"").replace(/<\/pre>\s*$/i,""))});
        } else if (/^<blockquote>/i.test(line)) {
          const raw = collect(/<\/blockquote>\s*$/i,"Note box"); push({type:"callout",...formatted(raw.replace(/^<blockquote>/i,"").replace(/<\/blockquote>\s*$/i,""),context)});
        } else if ((match = line.match(/^(={1,6})\s*(.*?)\s*\1\s*$/))) {
          push({type:"heading"+match[1].length, ...formatted(match[2],context)}); i++;
        } else if (/^-{4,}\s*$/.test(line)) { push({type:"horizontal-rule"}); i++; }
        else if (/^[*#]/.test(line)) {
          const entries = [];
          while (i < lines.length && (match = lines[i].match(/^([*#]+)\s?(.*)$/))) {
            if (match[1].length > 12) throw new Error("Lists support up to 12 nesting levels.");
            entries.push({path:match[1], ...formatted(match[2],context)}); i++;
          }
          push({type:"wiki-list", entries});
        } else if (line.startsWith(" ")) {
          const text = []; while(i<lines.length && lines[i].startsWith(" ")) text.push(lines[i++].slice(1));
          push({type:"preformatted",text:text.join("\n")});
        } else if (line.startsWith("{|")) {
          i++; const rows = []; let cells = [], caption = "", closed = false;
          while(i<lines.length) {
            const rowLine = lines[i++];
            if (/^\|}\s*$/.test(rowLine)) { closed = true; break; }
            if (rowLine.startsWith("|+")) { caption = rowLine.slice(2).trim(); continue; }
            if (rowLine.startsWith("|-")) { if(cells.length) rows.push(cells); cells=[]; continue; }
            if (/^[!|]/.test(rowLine)) {
              const header = rowLine[0] === "!";
              for (let value of splitOutside(rowLine.slice(1),header ? "!!" : "||")) {
                let colspan=1,rowspan=1;
                const attrs = value.match(/^\s*((?:(?:colspan|rowspan)\s*=\s*["']?\d+["']?\s*)+)\|([\s\S]*)$/i);
                if(attrs) {
                  colspan = Math.min(20,Math.max(1,Number(attrs[1].match(/colspan\s*=\s*["']?(\d+)/i)?.[1] || 1)));
                  rowspan = Math.min(20,Math.max(1,Number(attrs[1].match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] || 1)));
                  value=attrs[2];
                } else if (/^\s*[a-z]+\s*=[^|]+\|/i.test(value)) throw new Error("Table cells support colspan and rowspan attributes; use the wiki's default table styling.");
                cells.push({header,colspan,rowspan,...formatted(value.trim(),context)});
              }
            } else if (rowLine.trim() && cells.length) {
              const cell = cells[cells.length-1]; const more = formatted(rowLine,context); cell.html += "<br>"+more.html; cell.text += "\n"+more.text;
            } else if (rowLine.trim()) throw new Error("Start a table cell with | or !.");
          }
          if(!closed) throw new Error("Table is missing its closing |}.");
          if(cells.length) rows.push(cells);
          if(rows.length>200 || rows.some(row=>row.length>30)) throw new Error("Tables support at most 200 rows and 30 cells per row.");
          push({type:"table",caption:formatted(caption,context), rows});
        } else if (line.startsWith("{{")) {
          const raw = collect(/}}\s*$/, "Template"); push(templateBlock(raw.trim(),context));
        } else if (/^\[\[(File|Image):/i.test(line)) {
          if(!/\]\]\s*$/.test(line)) throw new Error("Image is missing its closing ]]."); push(imageBlock(line.trim(),context)); i++;
        } else {
          const paragraph = [line]; i++;
          while(i<lines.length && lines[i].trim() && !special(lines[i])) paragraph.push(lines[i++]);
          push({type:"paragraph",...formatted(paragraph.join("\n"),context)});
        }
      } catch(error) { error.line = start+1; throw new Error("Line " + (start+1) + ": " + error.message); }
    }
    return {type:"document",version:3,blocks, wikitext:{version:1, source}};
  }

  function inlineSource(block) {
    const textSource = value => literal(value).replace(/!/g,"&#33;").replace(/\r\n?|\n/g,"<br>");
    if (typeof block?.html !== "string") return textSource(block?.text || "");
    if (typeof document === "undefined") throw new Error("HTML conversion requires a browser document.");
    const node = document.createElement("template"); node.innerHTML = block.html;
    function visit(node) {
      if(node.nodeType === 3) return textSource(node.nodeValue);
      if(node.nodeType !== 1 && node.nodeType !== 11) return "";
      const content = [...node.childNodes].map(visit).join("");
      const tag = node.tagName;
      if(tag === "BR") return "<br>";
      if(tag === "B" || tag === "STRONG") return "'''"+content+"'''";
      if(tag === "I" || tag === "EM") return "''"+content+"''";
      if(["U","S","SUB","SUP"].includes(tag)) return "<"+tag.toLowerCase()+">"+content+"</"+tag.toLowerCase()+">";
      if(tag === "CODE") return "<code>"+escape(node.textContent)+"</code>";
      if(tag === "FONT" && fonts.includes(node.getAttribute("face"))) return '<font face="'+node.getAttribute("face")+'">'+content+'</font>';
      if(tag === "A") {
        const href = node.getAttribute("href") || "";
        if(/^wiki\.html\?page=/.test(href)) {
          const url = new URL(href,"https://wiki.invalid/");
          return "[["+literal(url.searchParams.get("page"))+(url.hash ? "#"+literal(decodeURIComponent(url.hash.slice(1))) : "")+"|"+content+"]]";
        }
        if(/^(https?:\/\/|mailto:)/i.test(href)) return "["+literal(href)+" "+content+"]";
        // Preserve same-site, relative, and fragment links safely as a visual block.
        throw new Error("Link requires a preserved visual block.");
      }
      return content;
    }
    return visit(node.content);
  }

  function format(content, context = {}) {
    const preserved = references(content); const parts=[];
    Object.values(preserved).forEach((block) => {
      try {
        if(block.type === "paragraph") {
          const text = inlineSource(block);
          // Protect literal line starts from becoming a list, rule, or preformatted block.
          parts.push(text ? text.replace(/^ /gm,"&#32;").replace(/^-{4,}/gm,match=>"&#45;".repeat(match.length)) : "<nowiki/>");
        }
        else if(/^heading[1-6]$/.test(block.type)) { const marks="=".repeat(Number(block.type.slice(-1))); parts.push(marks+" "+inlineSource(block)+" "+marks); }
        else if(["bullet-list","numbered-list"].includes(block.type)) parts.push((block.items||[]).map(item=>(block.type === "bullet-list" ? "* " : "# ")+inlineSource(typeof item === "object" ? item : {text:item})).join("\n"));
        else if(block.type === "wiki-list") parts.push((block.entries||[]).map(entry=>entry.path+" "+inlineSource(entry)).join("\n"));
        else if(block.type === "callout") parts.push("<blockquote>"+inlineSource(block)+"</blockquote>");
        else if(block.type === "preformatted") parts.push("<pre>"+escape(block.text)+"</pre>");
        else if(block.type === "comment") parts.push("<!--"+String(block.text||"").replace(/-->/g,"--&gt;")+"-->");
        else if(block.type === "horizontal-rule") parts.push("----");
        else if(block.type === "table") {
          const lines = ['{| class="wikitable"']; if(block.caption?.text || block.caption?.html) lines.push("|+ "+inlineSource(block.caption));
          for(const row of block.rows || []) {
            lines.push("|-");
            for(const cell of row) {
              const attrs = (cell.colspan > 1 ? 'colspan="'+cell.colspan+'" ' : "")+(cell.rowspan > 1 ? 'rowspan="'+cell.rowspan+'" ' : "");
              lines.push((cell.header ? "! " : "| ")+(attrs ? attrs+"| " : "")+inlineSource(cell));
            }
          }
          lines.push("|}"); parts.push(lines.join("\n"));
        } else if(block.type === "template") {
          const template = (context.templates||[]).find(t=>t.id === block.templateId);
          const name = template?.slug || block.templateSlug;
          if(!name) throw new Error("Unnamed template");
          const params=["|cf-ref="+block.id];
          if (
            block.layout !== undefined || block.widthPercent !== undefined || block.scale !== undefined ||
            block.fullWidth !== undefined || block.baseWidthPercent !== undefined
          ) params.push(
            "|cf-object-layout="+(["inline","wrap-left","wrap-right","break","behind","front"].includes(block.layout) ? block.layout : "wrap-right"),
            "|cf-object-width="+Math.min(100,Math.max(10,Number(block.widthPercent)||46)),
            "|cf-object-base-width="+Math.min(100,Math.max(10,Number(block.baseWidthPercent)||Number(block.widthPercent)||46)),
            "|cf-object-scale="+Math.min(3,Math.max(0.25,Number(block.scale)||1)),
            "|cf-object-full-width="+(block.fullWidth === true ? "1" : "0"),
            "|cf-object-x="+Math.min(85,Math.max(0,Number(block.xPercent)||0)),
            "|cf-object-y="+Math.min(5000,Math.max(0,Number(block.yPixels)||0))
          );
          params.push(...Object.entries(block.values || {}).map(([key,value])=>"|"+key+"="+literal(value)));
          parts.push("{{"+name+(params.length ? "\n"+params.join("\n")+"\n" : "")+"}}");
        } else if(block.type === "image") {
          const target = block.mediaId || (/^https:\/\//i.test(block.url) ? block.url : "");
          if(!target) throw new Error("Image requires preservation");
          const layout = ({"wrap-left":"left","wrap-right":"right","break":"center",inline:"inline",behind:"cf-layout=behind",front:"cf-layout=front"})[block.layout] || "inline";
          parts.push("[[File:"+literal(target)+"|cf-ref="+block.id+"|thumb|"+layout+"|"+(block.widthPercent||72)+"%|alt="+literal(block.alt)+"|"+literal(block.caption)+"]]");
        } else throw new Error("Preserve visual block");
      } catch(error) { parts.push("{{CFBlock|"+block.id+"}}"); }
    });
    return {source:parts.join("\n\n"), preserved};
  }
  return Object.freeze({parse,format,inline,references,splitOutside,slugify});
});
