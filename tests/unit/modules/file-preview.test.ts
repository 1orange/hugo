import { test } from "node:test";
import assert from "node:assert/strict";
import {
  driveFileViewUrl,
  isHeicMimeType,
  previewKindForMimeType,
  xmlPreviewCharset,
} from "../../../src/modules/file-preview.ts";

test("XML previews as text, whatever its mime type says", () => {
  // Bank statements arrive as XML: shown as the text they are, never as a document.
  assert.equal(previewKindForMimeType("application/xml"), "text");
  assert.equal(previewKindForMimeType("text/xml; charset=windows-1250"), "text");
});

test("an XML preview uses the charset its declaration names, else UTF-8", () => {
  assert.equal(xmlPreviewCharset('<?xml version="1.0" encoding="windows-1250"?><výpis/>'), "windows-1250");
  assert.equal(xmlPreviewCharset("ï»¿<?xml version='1.0' encoding='UTF-8'?>"), "utf-8");
  assert.equal(xmlPreviewCharset("<výpis>no declaration</výpis>"), "utf-8");
});

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
