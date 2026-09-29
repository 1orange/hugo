import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeModelAmountLiteral,
  normalizeModelCurrency,
  normalizeModelDate,
  normalizeModelDic,
  normalizeModelDocumentNumber,
  normalizeModelIcDph,
  normalizeModelTaxNumbers,
  normalizeModelIco,
  normalizeModelPartyName,
  normalizeModelVariableSymbol,
} from "../../../src/modules/model-output-normalize.ts";

// Seen from Qwen3 0.6B on her May invoices: dates as printed, not ISO as asked.
test("dates as printed on Slovak and Czech invoices become ISO", () => {
  assert.equal(normalizeModelDate("26.05.2026"), "2026-05-26");
  assert.equal(normalizeModelDate("6.5.2026"), "2026-05-06");
  assert.equal(normalizeModelDate("26. 05. 2026"), "2026-05-26");
  assert.equal(normalizeModelDate("2026-05-26"), "2026-05-26");
});

test("a date that is not a real date is dropped", () => {
  assert.equal(normalizeModelDate("31.02.2026"), null);
  assert.equal(normalizeModelDate("splatné do 14 dní"), null);
  assert.equal(normalizeModelDate(null), null);
});

test("currency symbols become ISO codes", () => {
  assert.equal(normalizeModelCurrency("€"), "EUR");
  assert.equal(normalizeModelCurrency("eur"), "EUR");
  assert.equal(normalizeModelCurrency("Kč"), "CZK");
  assert.equal(normalizeModelCurrency(" czk "), "CZK");
  assert.equal(normalizeModelCurrency("USD"), "USD");
  assert.equal(normalizeModelCurrency(null), "EUR");
});

test("an IČO is eight digits, spacing ignored; anything else is not one", () => {
  assert.equal(normalizeModelIco("45 891 761"), "45891761");
  assert.equal(normalizeModelIco("SPRING.etc. spol. s r.o."), null);
  assert.equal(normalizeModelIco("1234"), null);
});

test("a variabilný symbol is up to ten digits; a sentence is not one", () => {
  assert.equal(normalizeModelVariableSymbol("2026 080"), "2026080");
  assert.equal(
    normalizeModelVariableSymbol("Celková suma s DPH sa môže líšiť od súčtu"),
    null,
  );
  assert.equal(normalizeModelVariableSymbol("12345678901"), null);
});

test("IČ DPH loses its spacing and is upper-cased", () => {
  assert.equal(normalizeModelIcDph("sk 2020449189"), "SK2020449189");
  assert.equal(normalizeModelIcDph(""), null);
});

// From OCR text the model kept the label: `ICDPH|SK2121428375`.
test("a tax number loses the label printed before it", () => {
  assert.equal(normalizeModelIcDph("ICDPH|SK2121428375"), "SK2121428375");
  assert.equal(normalizeModelIcDph("IČ DPH: SK 2020449189"), "SK2020449189");
  assert.equal(normalizeModelDic("DIC:2022620941"), "2022620941");
  assert.equal(normalizeModelIcDph("IČ DPH:"), null);
});

// What the model put in tax number fields on her documents, and was not one.
test("what is not a tax number is no tax number", () => {
  assert.equal(normalizeModelDic("BDO 000012345"), null);
  assert.equal(normalizeModelIcDph("+421900123456"), null);
  assert.equal(normalizeModelIcDph("BA123XY"), null);
  assert.equal(normalizeModelDic("BA123XY"), null);
  assert.equal(normalizeModelIcDph("SK00 1234 5678 9012 3456 7890"), null);
  assert.equal(normalizeModelDic("1C09080:930"), null);
  assert.equal(normalizeModelIcDph("PLATBA"), null);
});

test("DIČ and IČ DPH of the countries on her invoices", () => {
  assert.equal(normalizeModelDic("2020123456"), "2020123456");
  assert.equal(normalizeModelDic("CZ49451871"), "CZ49451871");
  assert.equal(normalizeModelDic("929-193-54-94"), "9291935494");
  assert.equal(normalizeModelIcDph("CZ 699 000 761"), "CZ699000761");
  assert.equal(normalizeModelIcDph("IE 3668997OH"), "IE3668997OH");
  assert.equal(normalizeModelIcDph("ATU 12345678"), "ATU12345678");
});

// MODIVO prints "DIČ: SK4120004493"; a Slovak DIČ has no prefix.
test("a VAT number given as the DIČ is the IČ DPH; ten digits given as the IČ DPH are the DIČ", () => {
  assert.deepEqual(normalizeModelTaxNumbers({ dic: "SK4120004493", icDph: null }), {
    dic: null,
    icDph: "SK4120004493",
  });
  assert.deepEqual(normalizeModelTaxNumbers({ dic: null, icDph: "2020123456" }), {
    dic: "2020123456",
    icDph: null,
  });
  assert.deepEqual(normalizeModelTaxNumbers({ dic: "SK7120001713", icDph: "SK7120001713" }), {
    dic: null,
    icDph: "SK7120001713",
  });
  // A Czech DIČ is its VAT number, and stays where it was printed.
  assert.deepEqual(normalizeModelTaxNumbers({ dic: "CZ49451871", icDph: null }), {
    dic: "CZ49451871",
    icDph: null,
  });
});

test("a document number loses the label printed before it", () => {
  assert.equal(normalizeModelDocumentNumber("Faktúra - daňový doklad - 5420373176"), "5420373176");
  assert.equal(normalizeModelDocumentNumber("Faktúra č. 1792929-SK1126-680675"), "1792929-SK1126-680675");
  assert.equal(normalizeModelDocumentNumber("Faktúra číslo: 2026081"), "2026081");
  assert.equal(normalizeModelDocumentNumber("VF12584362026"), "VF12584362026");
  assert.equal(normalizeModelDocumentNumber("IDk26008"), "IDk26008");
});

test("a label with no number is not a document number", () => {
  assert.equal(normalizeModelDocumentNumber("Faktúra"), null);
  assert.equal(normalizeModelDocumentNumber(null), null);
});

test("a section heading is not a company name", () => {
  assert.equal(normalizeModelPartyName("Dodávateľ"), null);
  assert.equal(normalizeModelPartyName("Odberateľ:"), null);
  assert.equal(normalizeModelPartyName(" O2 Slovakia, s.r.o. "), "O2 Slovakia, s.r.o.");
});

// Seen from Qwen3 0.6B: `563,96 EUR` failed to parse, so the total came back empty.
test("an amount loses its currency and its thousands spacing", () => {
  assert.equal(normalizeModelAmountLiteral("563,96 EUR"), "563,96");
  assert.equal(normalizeModelAmountLiteral("€ 12.50"), "12.50");
  assert.equal(normalizeModelAmountLiteral("1 180,12 Kč"), "1180,12");
  assert.equal(normalizeModelAmountLiteral("EUR"), null);
  assert.equal(normalizeModelAmountLiteral("1.180,12"), "1.180,12");
});
