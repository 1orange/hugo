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

/** A one-page PDF holding a single uncompressed 1-bit DeviceGray image, top half white. */
function oneBitImagePdf(width: number, height: number): Uint8Array {
  const rowBytes = Math.ceil(width / 8);
  const pixels = new Uint8Array(rowBytes * height);
  pixels.fill(0xff, 0, rowBytes * Math.floor(height / 2));
  const encoder = new TextEncoder();
  const head = encoder.encode(
    "%PDF-1.4\n" +
      "1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n" +
      "2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n" +
      `3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources <</XObject <</Im0 5 0 R>>>> /Contents 4 0 R>> endobj\n` +
      `4 0 obj <</Length 30>> stream\nq ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\nendstream endobj\n` +
      `5 0 obj <</Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Length ${pixels.length}>> stream\n`,
  );
  const tail = encoder.encode("\nendstream endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n");
  const pdf = new Uint8Array(head.length + pixels.length + tail.length);
  pdf.set(head, 0);
  pdf.set(pixels, head.length);
  pdf.set(tail, head.length + pixels.length);
  return pdf;
}

// A scanner's page is a large 1-bit image (JBIG2 or CCITT). pdf.js hands the
// operator list back before such an image is decoded, and the image arrives as
// packed bits: both used to drop the page, so OCR got nothing.
test("a large 1-bit scan image is extracted once decoded, unpacked to RGBA", async () => {
  const width = 2003; // not a multiple of 8: each row is padded to a whole byte
  const height = 2400;
  const [image, ...rest] = await createPdfAccess().extractPageImages(oneBitImagePdf(width, height));

  assert.equal(rest.length, 0);
  assert.ok(image && image.kind === "rgba");
  assert.equal(image.width, width);
  assert.equal(image.height, height);
  assert.equal(image.data.length, width * height * 4);
  const pixel = (x: number, y: number) => image.data[(y * width + x) * 4];
  assert.equal(pixel(0, 0), 255, "a set bit is white");
  assert.equal(pixel(width - 1, 10), 255, "the last pixel of a padded row");
  assert.equal(pixel(0, height - 1), 0, "a clear bit is black");
  assert.equal(pixel(width - 1, height - 1), 0);
});
