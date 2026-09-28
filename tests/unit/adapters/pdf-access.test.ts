import { test } from "node:test";
import assert from "node:assert/strict";
import { createPdfAccess } from "../../../src/adapters/pdf/pdf-access.ts";

// A one-page PDF with no text and no images; pdf.js rebuilds the missing xref.
const EMPTY_PAGE_PDF = new TextEncoder().encode(
  "%PDF-1.4\n" +
    "1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n" +
    "2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n" +
    "3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 10 10]>> endobj\n" +
    "trailer <</Root 1 0 R>>\n%%EOF\n",
);

// pdf.js takes ownership of the buffer it is given. The pipeline reads a scan
// twice — the text layer, then the page images for the QR code — and the
// second read used to throw DataCloneError, which stopped the whole month.
test("the same PDF bytes can be read more than once", async () => {
  const pdf = createPdfAccess();
  const bytes = EMPTY_PAGE_PDF.slice();
  const length = bytes.byteLength;

  assert.deepEqual(await pdf.extractTextLines(bytes), []);
  assert.equal(bytes.byteLength, length);
  assert.deepEqual(await pdf.extractPageImages(bytes), []);
  assert.deepEqual(await pdf.extractTextLines(bytes, { maxPages: 5 }), []);
});
