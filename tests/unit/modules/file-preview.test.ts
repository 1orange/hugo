import { test } from "node:test";
import assert from "node:assert/strict";
import {
  driveFileViewUrl,
  previewKindForMimeType,
} from "../../../src/modules/file-preview.ts";

test("preview kind maps common mime types and HEIC to fallback", () => {
  assert.equal(previewKindForMimeType("application/pdf"), "pdf");
  assert.equal(previewKindForMimeType("image/jpeg"), "image");
  assert.equal(previewKindForMimeType("image/heic"), "heic-fallback");
  assert.equal(previewKindForMimeType("text/plain"), "unsupported");
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

test("preview kind ignores case and surrounding whitespace", () => {
  assert.equal(previewKindForMimeType("  Application/PDF "), "pdf");
  assert.equal(previewKindForMimeType("IMAGE/HEIC"), "heic-fallback");
});

test("drive file view url points at Drive", () => {
  assert.equal(
    driveFileViewUrl("abc123"),
    "https://drive.google.com/file/d/abc123/view",
  );
});
