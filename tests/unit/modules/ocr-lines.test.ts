import { test } from "node:test";
import assert from "node:assert/strict";
import { groupOcrBoxesIntoLines, type OcrBox } from "../../../src/modules/ocr-lines.ts";

test("groupOcrBoxesIntoLines merges cells on the same row with pipe separators", () => {
  const boxes: OcrBox[] = [
    { text: "DPH", x: 100, y: 50 },
    { text: "23%", x: 200, y: 50 },
    { text: "Footer", x: 10, y: 10 },
  ];
  const lines = groupOcrBoxesIntoLines(boxes);
  assert.deepEqual(lines, ["DPH | 23%", "Footer"]);
});

test("groupOcrBoxesIntoLines sorts top-to-bottom like pdf-access", () => {
  const boxes: OcrBox[] = [
    { text: "bottom", x: 0, y: 0 },
    { text: "top", x: 0, y: 100 },
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
