import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeOcr, unreachableFakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import type { PdfAccess, PdfPageImage } from "../../../src/adapters/pdf/port.ts";
import {
  MODEL_MAX_PDF_PAGES,
  modelTextForDocument,
} from "../../../src/lib/model-extraction/model-text.ts";

const PAGE_IMAGE: PdfPageImage = {
  kind: "rgba",
  data: new Uint8ClampedArray([0, 0, 0, 255]),
  width: 1,
  height: 1,
};

function pdfAccess(lines: string[], seen: Array<Parameters<PdfAccess["extractTextLines"]>[1]> = []): PdfAccess {
  return {
    async extractTextLines(_bytes, options) {
      seen.push(options);
      return lines;
    },
    async extractAttachments() {
      return [];
    },
    async extractPageImages() {
      return [PAGE_IMAGE];
    },
  };
}

test("the model reads a PDF's text layer in reading order, up to its page limit", async () => {
  const seen: Array<Parameters<PdfAccess["extractTextLines"]>[1]> = [];
  const text = await modelTextForDocument({
    mimeType: "application/pdf",
    fileBytes: new Uint8Array([1]),
    pdfAccess: pdfAccess(["Faktúra 2026081"], seen),
    ocr: new FakeOcr(),
  });
  assert.deepEqual(seen, [{ maxPages: MODEL_MAX_PDF_PAGES, order: "reading" }]);
  assert.equal(text.ok && text.source, "model");
  assert.deepEqual(text.ok && text.lines, ["Faktúra 2026081"]);
});

test("a scan without a text layer is read by OCR, a column at a time", async () => {
  const box = (value: string, x: number, y: number) => ({ text: value, x, y, width: 400, height: 40 });
  const text = await modelTextForDocument({
    mimeType: "application/pdf",
    fileBytes: new Uint8Array([1]),
    pdfAccess: pdfAccess([]),
    ocr: new FakeOcr({
      boxes: [
        box("Dodávateľ:", 0, 0),
        box("IČO: 45891761", 0, 90),
        box("Odberateľ:", 1500, 45),
        box("IČO: 51998688", 1500, 135),
      ],
    }),
  });
  assert.equal(text.ok && text.source, "ocr");
  assert.deepEqual(text.ok && text.lines, [
    "Dodávateľ:",
    "IČO: 45891761",
    "",
    "Odberateľ:",
    "IČO: 51998688",
  ]);
});

test("a scan waits while OCR is unreachable", async () => {
  const text = await modelTextForDocument({
    mimeType: "application/pdf",
    fileBytes: new Uint8Array([1]),
    pdfAccess: pdfAccess([]),
    ocr: unreachableFakeOcr(),
  });
  assert.deepEqual(text, { ok: false, ocrUnreachable: true });
});

test("stub lines stand in for the text layer without reading the PDF", async () => {
  const seen: Array<Parameters<PdfAccess["extractTextLines"]>[1]> = [];
  const text = await modelTextForDocument({
    mimeType: "application/pdf",
    fileBytes: new Uint8Array([1]),
    pdfAccess: pdfAccess(["from the PDF"], seen),
    ocr: new FakeOcr(),
    textLayerLines: ["from the stub"],
  });
  assert.equal(seen.length, 0);
  assert.deepEqual(text.ok && text.lines, ["from the stub"]);
});
