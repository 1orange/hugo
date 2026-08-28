import { test } from "node:test";
import assert from "node:assert/strict";
import {
  driveFileViewUrl,
  isHeicMimeType,
  previewKindForMimeType,
} from "../../../src/modules/file-preview.ts";

test("preview kind maps the types the preview route serves", () => {
  assert.equal(previewKindForMimeType("application/pdf"), "pdf");
  assert.equal(previewKindForMimeType("image/jpeg"), "image");
  assert.equal(previewKindForMimeType("text/plain"), "unsupported");
});

test("HEIC previews as an image because the route converts it", () => {
  assert.equal(previewKindForMimeType("image/heic"), "image");
  assert.equal(previewKindForMimeType("image/heif"), "image");
  assert.ok(isHeicMimeType("IMAGE/HEIC"));
  assert.ok(isHeicMimeType("image/heic-sequence"));
  assert.equal(isHeicMimeType("image/jpeg"), false);
});

test("active content types are never previewable", () => {
  // The preview route streams from the app's own origin, so anything a client
  // could upload that executes must not be classified as renderable.
  for (const mimeType of [
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "APPLICATION/XHTML+XML",
    "text/html; charset=utf-8",
  ]) {
    assert.equal(previewKindForMimeType(mimeType), "unsupported", mimeType);
  }
});

test("preview kind ignores case, whitespace and mime parameters", () => {
  assert.equal(previewKindForMimeType("  Application/PDF "), "pdf");
  assert.equal(previewKindForMimeType("IMAGE/HEIC"), "image");
  assert.equal(previewKindForMimeType("image/jpeg; charset=binary"), "image");
});

test("drive file view url points at Drive", () => {
  assert.equal(
    driveFileViewUrl("abc123"),
    "https://drive.google.com/file/d/abc123/view",
  );
});
