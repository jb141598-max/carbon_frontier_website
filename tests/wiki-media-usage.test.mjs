import test from "node:test";
import assert from "node:assert/strict";
import { mediaUsageImpact } from "../netlify/functions/_shared/wiki-media-usage.mjs";

const media = { id: "test-asset", original_name: "LV Power Pole.png" };
const page = (slug, blocks) => ({
  slug, title: slug, content_json: { type: "document", blocks,
    wikitext: { source: blocks.length ? "[[File:test-asset]]" : "" } },
});
const template = (slug, source) => ({
  id: "template-" + slug, slug, name: slug,
  definition_json: { kind: "wikitext", source },
});

test("counts current page images without double-counting mirrored wikitext", () => {
  const result = mediaUsageImpact(media, [
    page("power", [{ type: "image", mediaId: "test-asset" }]),
    page("prose", [{ type: "paragraph", text: "LV Power Pole.png" }]),
  ]);
  assert.equal(result.pagePlacements, 1);
  assert.equal(result.pageCount, 1);
  assert.equal(result.pages[0].slug, "power");
});

test("resolves template image placeholders and ignores unused image values", () => {
  const templates = [template("image-card", "<includeonly>[[File:{{{image|Example.png}}}|frameless]]</includeonly>")];
  const result = mediaUsageImpact(media, [
    page("card", [{ type: "template", templateSlug: "image-card",
      values: { image: "LV Power Pole.png", unused_image: "LV Power Pole.png" } }]),
  ], templates);
  assert.equal(result.pagePlacements, 1);
});

test("repeating button groups respect their saved count", () => {
  const templates = [template("row", "<includeonly><cf-repeat count=\"buttoncount\" prefix=\"button\" max=\"100\">{{PictureButton|image={{{button__N___image|}}}}}</cf-repeat></includeonly>")];
  const result = mediaUsageImpact(media, [
    page("rows", [{ type: "template", templateSlug: "row",
      values: { buttoncount: 2, button1_image: "LV_Power_Pole.png",
        button2_image: "test-asset", button3_image: "test-asset" } }]),
  ], templates);
  assert.equal(result.pageCount, 1);
  assert.equal(result.pagePlacements, 2);
});

test("static File markup counts as a template reference, documentation does not", () => {
  const templates = [
    template("actual", "<includeonly>[[File:LV Power Pole.png]]</includeonly>"),
    template("docs-only", "<includeonly>plain</includeonly><noinclude>[[File:LV Power Pole.png]]</noinclude>"),
  ];
  const result = mediaUsageImpact(media, [], templates);
  assert.equal(result.templateReferences, 1);
  assert.equal(result.templateCount, 1);
  assert.equal(result.templates[0].slug, "actual");
});

test("dynamic DPL galleries produce an uncertainty warning", () => {
  const gallery = template("category", "<includeonly>{{#dpl:|category=Power|format=,{{PictureButton|image=%PAGE%.png}},,}}</includeonly>");
  const result = mediaUsageImpact(media, [], [gallery]);
  assert.equal(result.pagePlacements, 0);
  assert.equal(result.mayHaveDynamicReferences, true);
});

test("usage fingerprint changes when published page references change", () => {
  const previous = mediaUsageImpact(media, [page("pole", [])]);
  const updated = mediaUsageImpact(media, [page("pole", [{ type: "image", mediaId: "test-asset" }])]);
  assert.notEqual(previous.version, updated.version);
});
