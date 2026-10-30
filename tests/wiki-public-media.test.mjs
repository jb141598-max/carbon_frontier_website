import test from "node:test";
import assert from "node:assert/strict";
import {
  canReadWikiMedia,
  canEditWikiMediaMetadata,
} from "../netlify/functions/_shared/wiki-media-policy.mjs";

const publicReader = { canView: true, canEdit: false, isAssignedStaff: false };
const publicEditor = { canView: true, canEdit: true, isAssignedStaff: false };
const wikiStaff = { canView: true, canEdit: true, isAssignedStaff: true };

test("anonymous public viewers can access the image name catalog", () => {
  assert.equal(canReadWikiMedia(publicReader), true);
  assert.equal(canEditWikiMediaMetadata(publicReader, null, "uploader@example.com"), false);
});

test("signed-in readers without edit rights can still view images", () => {
  assert.equal(canReadWikiMedia(publicReader), true);
  assert.equal(canEditWikiMediaMetadata(publicReader, { email: "uploader@example.com" }, "uploader@example.com"), false);
});

test("a private wiki denies image reads to unassigned viewers", () => {
  assert.equal(canReadWikiMedia({ canView: false, canEdit: false }), false);
  assert.equal(canReadWikiMedia(null), false);
});

test("public editors can edit metadata only for their own uploads", () => {
  assert.equal(canEditWikiMediaMetadata(publicEditor, { email: "UPLOADER@EXAMPLE.COM" }, "uploader@example.com"), true);
  assert.equal(canEditWikiMediaMetadata(publicEditor, { email: "other@example.com" }, "uploader@example.com"), false);
  assert.equal(canEditWikiMediaMetadata(publicEditor, null, "uploader@example.com"), false);
});

test("assigned staff can manage media metadata", () => {
  assert.equal(canReadWikiMedia(wikiStaff), true);
  assert.equal(canEditWikiMediaMetadata(wikiStaff, { email: "staff@example.com" }, "uploader@example.com"), true);
});
