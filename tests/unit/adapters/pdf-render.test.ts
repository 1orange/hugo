import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createPdfAccess } from "../../../src/adapters/pdf/pdf-access.ts";
import type { PdfAccess, PdfPageImage } from "../../../src/adapters/pdf/port.ts";
import { pageImagesForDocument } from "../../../src/lib/ocr/document-ocr.ts";

// One A4 page with a line of Helvetica — a font the PDF does not embed, as
// many invoicing programs leave it — and no image at all.
function textOnlyPdf(text: string): Uint8Array {
  const content = `BT /F1 36 Tf 72 740 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function inkRows(image: PdfPageImage): Promise<{ width: number; height: number; inkedTop: boolean; inkedBottom: boolean }> {
  assert.equal(image.kind, "encoded");
  const { data, info } = await sharp(Buffer.from(image.kind === "encoded" ? image.bytes : new Uint8Array()))
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const inked = (fromRow: number, toRow: number) => {
    for (let index = fromRow * info.width; index < toRow * info.width; index += 1) {
      if (data[index * info.channels]! < 100) {
        return true;
      }
    }
    return false;
  };
  return {
    width: info.width,
    height: info.height,
    inkedTop: inked(0, Math.round(info.height * 0.2)),
    inkedBottom: inked(Math.round(info.height * 0.5), info.height),
  };
}

// A PDF saved again from Safari keeps its text as drawn glyphs: no image for
// OCR to read, so the page itself is drawn.
test("a page is drawn with its text, on white, at the size asked", async () => {
  const [page, ...rest] = await createPdfAccess().renderPages!(textOnlyPdf("Spolu 120,00 EUR"), {
    maxPages: 5,
    longSidePx: 1000,
  });
  assert.equal(rest.length, 0);
  const ink = await inkRows(page!);
  assert.deepEqual([ink.width, ink.height], [707, 1000]);
  assert.equal(ink.inkedTop, true, "the line of text is drawn near the top");
  assert.equal(ink.inkedBottom, false, "the rest of the page is paper white");
});

test("a PDF with no image is drawn for OCR", async () => {
  const images = await pageImagesForDocument({
    mimeType: "application/pdf",
    fileBytes: textOnlyPdf("Faktura 2026042"),
    pdfAccess: createPdfAccess(),
  });
  assert.equal(images.length, 1);
});

test("a scan is read from its own images; drawn only when asked", async () => {
  const scanned: PdfPageImage = { kind: "encoded", bytes: new Uint8Array([1]) };
  const drawn: PdfPageImage = { kind: "encoded", bytes: new Uint8Array([2]) };
  const access = (renderPages?: PdfAccess["renderPages"]): PdfAccess => ({
    async extractTextLines() {
      return [];
    },
    async extractAttachments() {
      return [];
    },
    async extractPageImages() {
      return [scanned];
    },
    ...(renderPages ? { renderPages } : {}),
  });
  const read = (pdfAccess: PdfAccess, drawPages: boolean) =>
    pageImagesForDocument({ mimeType: "application/pdf", fileBytes: new Uint8Array([0]), pdfAccess, drawPages });

  assert.deepEqual(await read(access(async () => [drawn]), false), [scanned]);
  assert.deepEqual(await read(access(async () => [drawn]), true), [drawn]);
  // Where drawing fails or is not to be had, the images are what there is.
  assert.deepEqual(await read(access(async () => { throw new Error("no canvas"); }), true), [scanned]);
  assert.deepEqual(await read(access(), true), [scanned]);
});
