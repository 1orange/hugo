import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEkasaReceipt,
  parseEkasaText,
  printsEkasaMarks,
  validateEkasaArithmetic,
} from "../../../src/modules/ekasa-text.ts";
import {
  syntheticEkasaLines,
  SYNTHETIC_FIXTURE,
} from "../cash-discovery/synthetic-ekasa-lines.ts";

test("isEkasaReceipt requires UID, OKP and NA ÚHRADU markers", () => {
  const lines = syntheticEkasaLines();
  assert.equal(isEkasaReceipt(lines), true);
  assert.equal(isEkasaReceipt(["train ticket", "Celkem | 30.90 EUR"]), false);
});

// A parking machine is outside eKasa: its ticket has no UID to ask for.
test("one eKasa mark is enough; a parking ticket shows none", () => {
  assert.equal(printsEkasaMarks(syntheticEkasaLines()), true);
  // As OCR reads a scan: an O read as a zero, the rest of the lines lost.
  assert.equal(printsEkasaMarks(["UID: 0-1234567890ABCDEF1234567890ABCDEF"]), true);
  assert.equal(printsEkasaMarks(["*** OVERTE DOKLAD POMOCOU QR KÓDU"]), true);
  assert.equal(printsEkasaMarks(["Kód pokladnice: 88820200000000001"]), true);
  assert.equal(
    printsEkasaMarks([
      "Parkovisko Centrum s.r.o.",
      "IČ DPH: SK2120000000",
      "Automat 12 23.07.26 20:29",
      "Potvrdenka 12345",
      "Krátkodobé parkovné",
      "Spolu s DPH | €3,00",
      "Terminál: 10000001",
      "Autorizačný kód: 123456",
    ]),
    false,
  );
});

test("parseEkasaText extracts synthetic receipt facts", () => {
  const parsed = parseEkasaText(syntheticEkasaLines());
  assert.equal("supplierName" in parsed, true);
  if (!("supplierName" in parsed)) {
    return;
  }

  assert.equal(parsed.supplierName, SYNTHETIC_FIXTURE.supplierName);
  assert.equal(parsed.dic, SYNTHETIC_FIXTURE.dic);
  assert.equal(parsed.ico, SYNTHETIC_FIXTURE.ico);
  assert.equal(parsed.icDph, SYNTHETIC_FIXTURE.icDph);
  assert.equal(parsed.kp, SYNTHETIC_FIXTURE.kp);
  assert.equal(parsed.receiptNumber, SYNTHETIC_FIXTURE.receiptNumber);
  assert.equal(parsed.timestampRaw, SYNTHETIC_FIXTURE.timestampRaw);
  assert.equal(parsed.receiptAtUtc, SYNTHETIC_FIXTURE.receiptAtUtc);
  assert.equal(parsed.totalLiteral, SYNTHETIC_FIXTURE.totalLiteral);
  assert.equal(parsed.totalCents, SYNTHETIC_FIXTURE.totalCents);
  assert.equal(parsed.currency, SYNTHETIC_FIXTURE.currency);
  assert.equal(parsed.okp, SYNTHETIC_FIXTURE.okp);
  assert.equal(parsed.uid, SYNTHETIC_FIXTURE.uid);
  assert.equal(parsed.recapSpoluBaseLiteral, SYNTHETIC_FIXTURE.recapSpoluBaseLiteral);
  assert.equal(parsed.recapSpoluBaseCents, SYNTHETIC_FIXTURE.recapSpoluBaseCents);
  assert.equal(parsed.recapSpoluVatLiteral, SYNTHETIC_FIXTURE.recapSpoluVatLiteral);
  assert.equal(parsed.recapSpoluVatCents, SYNTHETIC_FIXTURE.recapSpoluVatCents);
  assert.equal(parsed.lineItems.length, 2);
  assert.deepEqual(parsed.lineItems[0], SYNTHETIC_FIXTURE.lineItems[0]);
  assert.deepEqual(parsed.lineItems[1], SYNTHETIC_FIXTURE.lineItems[1]);
  assert.equal(parsed.recapRows.length, 1);
  assert.equal(parsed.recapRows[0]?.rateLiteral, "23.0");
});

test("validateEkasaArithmetic passes when item sum and SPOLU match NA ÚHRADU", () => {
  const parsed = parseEkasaText(syntheticEkasaLines());
  assert.equal("supplierName" in parsed, true);
  if (!("supplierName" in parsed)) {
    return;
  }
  assert.deepEqual(validateEkasaArithmetic(parsed), { ok: true });
});

test("validateEkasaArithmetic rejects item sum mismatch", () => {
  const parsed = parseEkasaText(syntheticEkasaLines());
  assert.equal("supplierName" in parsed, true);
  if (!("supplierName" in parsed)) {
    return;
  }
  parsed.lineItems[0]!.lineTotalCents = 500;
  const check = validateEkasaArithmetic(parsed);
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.match(check.reason, /Item line totals sum/);
    assert.match(check.reason, /16.85/);
  }
});

test("validateEkasaArithmetic rejects SPOLU mismatch with NA ÚHRADU", () => {
  const parsed = parseEkasaText(syntheticEkasaLines());
  assert.equal("supplierName" in parsed, true);
  if (!("supplierName" in parsed)) {
    return;
  }
  parsed.recapSpoluVatCents = 300;
  parsed.recapSpoluVatLiteral = "3.00";
  parsed.recapRows[0]!.vatCents = 300;
  parsed.recapRows[0]!.vatLiteral = "3.00";
  const check = validateEkasaArithmetic(parsed);
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.match(check.reason, /SPOLU base \+ VAT/);
  }
});

test("parseEkasaText handles recap VAT without trailing zero", () => {
  const lines = syntheticEkasaLines();
  const recapIndex = lines.findIndex((line) => line.startsWith("23.0 %"));
  lines[recapIndex] = "23.0 % | 13.70 | 3.1";
  const parsed = parseEkasaText(lines);
  assert.equal("supplierName" in parsed, true);
  if ("supplierName" in parsed) {
    assert.equal(parsed.recapRows[0]?.vatLiteral, "3.1");
    assert.equal(parsed.recapRows[0]?.vatCents, 310);
  }
});

test("parseEkasaText resolves late-evening receipt in Bratislava local time", () => {
  const lines = syntheticEkasaLines();
  const tsIndex = lines.findIndex((line) => line.startsWith("Dátum a čas:"));
  lines[tsIndex] = "Dátum a čas: 28.01.2026 23:30:00";
  const parsed = parseEkasaText(lines);
  assert.equal("supplierName" in parsed, true);
  if ("supplierName" in parsed) {
    assert.equal(parsed.receiptAtUtc, "2026-01-28T22:30:00.000Z");
  }
});

test("parseEkasaText rejects non-eBloček documents", () => {
  const parsed = parseEkasaText(["FlixBus ticket", "Celkem | 1009.00 Kč"]);
  assert.equal("ok" in parsed && parsed.ok === false, true);
});

// A cash eBloček prints the unrounded items and SPOLU, and NA ÚHRADU rounded to
// 5 cents. No text-layer cash receipt exists in the corpus yet, so this one is
// synthetic: shift the items to end in 3 cents and round the payable total.
function roundedCashReceipt() {
  const parsed = parseEkasaText(syntheticEkasaLines());
  if (!("supplierName" in parsed)) {
    throw new Error("synthetic receipt did not parse");
  }
  const itemSum = parsed.lineItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const shift = (3 - (itemSum % 5) + 5) % 5;
  parsed.lineItems[0]!.lineTotalCents += shift;
  parsed.recapRows[0]!.baseCents += shift;
  parsed.recapSpoluBaseCents += shift;
  parsed.totalCents = itemSum + shift + 2;
  return parsed;
}

test("validateEkasaArithmetic accepts NA ÚHRADU rounded to 5 cents for cash", () => {
  assert.deepEqual(validateEkasaArithmetic(roundedCashReceipt()), { ok: true });
});

test("validateEkasaArithmetic rejects a difference that is not the cash rounding", () => {
  const parsed = roundedCashReceipt();
  parsed.totalCents += 1;
  assert.equal(validateEkasaArithmetic(parsed).ok, false);
});
