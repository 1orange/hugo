import { test } from "node:test";
import assert from "node:assert/strict";
import { textLayerLooksGarbled } from "../../../src/modules/text-layer-quality.ts";

const INVOICE = [
  "FAKTÚRA - DAŇOVÝ DOKLAD č. 2026042",
  "Dodávateľ: Autoservis Horák s. r. o. | Odberateľ: Modrá hora s. r. o.",
  "Hlavná 12, 917 01 Trnava | Nábrežie 4, 921 01 Piešťany",
  "IČO: 36123456 DIČ: 2020123456 IČ DPH: SK2020123456",
  "Dátum vystavenia: 04.05.2026 Dátum dodania: 04.05.2026 Dátum splatnosti: 18.05.2026",
  "Oprava bŕzd, výmena oleja a filtrov, kontrola podvozku | 1 ks | 240,00",
  "Základ dane 23 % | 240,00 | DPH | 55,20 | Spolu k úhrade | 295,20 EUR",
  "Faktúru vystavil: Peter Horák, telefón a email uvedené v hlavičke dokladu",
];

// What Safari's "Save as PDF" made of one such invoice: every glyph shifted
// by 29 code points, spaces lost.
function shifted(line: string): string {
  return [...line]
    .map((char) => String.fromCodePoint(char.codePointAt(0)! - 29))
    .filter((char) => char.codePointAt(0)! >= 0x21)
    .join("");
}

test("an invoice's text layer reads as text", () => {
  assert.equal(textLayerLooksGarbled(INVOICE), false);
});

test("a text layer whose glyphs are shifted does not", () => {
  assert.equal(textLayerLooksGarbled(INVOICE.map(shifted)), true);
});

test("a receipt printed in capitals still reads as text", () => {
  assert.equal(textLayerLooksGarbled(INVOICE.map((line) => line.toUpperCase())), false);
});

test("too little text is not judged", () => {
  assert.equal(textLayerLooksGarbled(INVOICE.slice(0, 1).map(shifted)), false);
});
