import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupOcrBoxesIntoLines,
  ocrReadingLines,
  type OcrBox,
} from "../../../src/modules/ocr-lines.ts";

test("groupOcrBoxesIntoLines merges cells on the same row with pipe separators", () => {
  const boxes: OcrBox[] = [
    { text: "DPH", x: 100, y: 50 },
    { text: "23%", x: 200, y: 50 },
    { text: "Footer", x: 10, y: 90 },
  ];
  const lines = groupOcrBoxesIntoLines(boxes);
  assert.deepEqual(lines, ["DPH | 23%", "Footer"]);
});

// The sidecar reports image pixels: the top of a photo is y = 0. Read as PDF
// points, every photo came out bottom-up.
test("groupOcrBoxesIntoLines reads a photo from its top, y = 0", () => {
  const boxes: OcrBox[] = [
    { text: "bottom", x: 0, y: 100 },
    { text: "top", x: 0, y: 0 },
  ];
  const lines = groupOcrBoxesIntoLines(boxes);
  assert.deepEqual(lines, ["top", "bottom"]);
});

test("groupOcrBoxesIntoLines normalizes text to NFC and skips empty cells", () => {
  const boxes: OcrBox[] = [
    { text: "  hello  ", x: 0, y: 20 },
    { text: "", x: 10, y: 20 },
  ];
  const lines = groupOcrBoxesIntoLines(boxes);
  assert.deepEqual(lines, ["hello"]);
});

test("pages are not merged: page two follows page one", () => {
  const boxes: OcrBox[] = [
    { text: "page two", x: 0, y: 10, page: 1 },
    { text: "page one", x: 0, y: 500, page: 0 },
  ];
  assert.deepEqual(groupOcrBoxesIntoLines(boxes), ["page one", "page two"]);
});

test("the model reads an OCR'd page a column at a time", () => {
  const box = (text: string, x: number, y: number): OcrBox => ({ text, x, y, width: 400, height: 40 });
  const lines = ocrReadingLines([
    box("Dodávateľ:", 0, 0),
    box("IČO: 45891761", 0, 90),
    box("Odberateľ:", 1500, 45),
    box("IČO: 51998688", 1500, 135),
  ]);
  assert.deepEqual(lines, ["Dodávateľ:", "IČO: 45891761", "", "Odberateľ:", "IČO: 51998688"]);
});
