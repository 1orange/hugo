import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readingOrderLines,
  readingOrderPages,
  type PositionedText,
} from "../../../src/modules/reading-order.ts";

function box(text: string, left: number, top: number, width = 80, height = 10): PositionedText {
  return { text, left, top, right: left + width, bottom: top + height };
}

// Like the header of her ABC invoice: the customer's lines sit between the
// supplier's, so reading by height alone put SPRING's IČO under "Odberateľ:".
function twoColumnHeader(offset = 0): PositionedText[] {
  return [
    box("Dodávateľ:", 0, offset),
    box("SPRING.etc. spol. s r.o.", 0, offset + 18, 120),
    box("IČO: 45891761", 0, offset + 36),
    box("DIČ: 2023141351", 0, offset + 54),
    box("Odberateľ:", 300, offset + 9),
    box("ABC Development s. r. o.", 300, offset + 27, 120),
    box("IČO: 51998688", 300, offset + 45),
  ];
}

test("an invoice's supplier and customer columns are read one after the other", () => {
  assert.deepEqual(readingOrderLines(twoColumnHeader()), [
    "Dodávateľ:",
    "SPRING.etc. spol. s r.o.",
    "IČO: 45891761",
    "DIČ: 2023141351",
    "",
    "Odberateľ:",
    "ABC Development s. r. o.",
    "IČO: 51998688",
  ]);
});

test("a label and its value stay on one line", () => {
  const lines = readingOrderLines([
    box("Variabilný symbol:", 0, 0, 90),
    box("2026081", 150, 0, 40),
    box("Konštantný symbol:", 0, 18, 90),
    box("Forma úhrady:", 0, 36, 70),
    box("Prevodný príkaz", 150, 36, 70),
  ]);
  assert.deepEqual(lines, [
    "Variabilný symbol: | 2026081",
    "Konštantný symbol:",
    "Forma úhrady: | Prevodný príkaz",
  ]);
});

test("a table's rows stay rows", () => {
  const row = (top: number, cells: string[]) =>
    cells.map((cell, index) => box(cell, index * 100, top, 60));
  const lines = readingOrderLines([
    ...row(0, ["1", "personalistika", "14,00", "23", "231,00"]),
    ...row(14, ["2", "účtovníctvo", "175,00", "23", "227,50"]),
  ]);
  assert.deepEqual(lines, [
    "1 | personalistika | 14,00 | 23 | 231,00",
    "2 | účtovníctvo | 175,00 | 23 | 227,50",
  ]);
});

test("a heading across the page is read before the columns under it", () => {
  const lines = readingOrderLines([box("Faktúra číslo: 2026081", 0, 0, 420), ...twoColumnHeader(30)]);
  assert.equal(lines[0], "Faktúra číslo: 2026081");
  assert.deepEqual(lines.slice(1, 3), ["Dodávateľ:", "SPRING.etc. spol. s r.o."]);
  assert.ok(lines.indexOf("IČO: 45891761") < lines.indexOf("Odberateľ:"));
});

test("a photo in pixels reads like a PDF in points", () => {
  const inPixels = twoColumnHeader().map((piece) => ({
    ...piece,
    left: piece.left * 5,
    top: piece.top * 5,
    right: piece.right * 5,
    bottom: piece.bottom * 5,
  }));
  assert.deepEqual(readingOrderLines(inPixels), readingOrderLines(twoColumnHeader()));
});

test("text is NFC-normalised and empty pieces are skipped", () => {
  const lines = readingOrderLines([box("Dodávateľ:", 0, 0), box("   ", 0, 18)]);
  assert.deepEqual(lines, ["Dodávateľ:"]);
});

test("pages are read in turn, an empty line between them", () => {
  assert.deepEqual(readingOrderPages([[box("page one", 0, 0)], [], [box("page two", 0, 0)]]), [
    "page one",
    "",
    "page two",
  ]);
});
