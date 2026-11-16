import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAdvanceSettlement } from "../../../src/modules/advance-settlement.ts";
import { mergeDocumentFields } from "../../../src/modules/document-fields.ts";
import type { ConfirmedPayload, DocumentVatRecapRow, ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";

// What she sees is decided by the merge: detection, her manual flag over it,
// and her typed values over both (PRD 0004 issue 11, ADR 0010).

function row(rate: string, baseCents: number, vatCents: number): DocumentVatRecapRow {
  const format = (cents: number) => (cents / 100).toFixed(2);
  return { rateLiteral: rate, baseLiteral: format(baseCents), baseCents, vatLiteral: format(vatCents), vatCents };
}

const SETTLED_LINES = [
  "Sadzba | Základ DPH | Čiastka DPH | Celkom s DPH",
  "23% | 364,65 | 83,87 | 448,52",
  "Celkom uhradených záloh: | 448,52 EUR",
  "Zálohové doklady č. : 5926010455 | 448,52 | EUR",
  "Celkom k úhrade vrátane DPH | 0,00 | EUR",
];

const PLAIN: ModelExtractedPayload = {
  kind: "extracted",
  source: "model",
  parties: [{ name: "Dodávateľ s.r.o.", ico: null, dic: null, icDph: "SK2020449189" }],
  documentNumber: "5022606206",
  variableSymbol: null,
  issueDate: null,
  taxableSupplyDate: "2026-05-11",
  dueDate: null,
  currency: "EUR",
  amountCents: 0,
  amountLiteral: "0.00",
  vatRecap: [row("23", 36465, 8387)],
  docTypeHint: "invoice",
};

const DETECTED = applyAdvanceSettlement(PLAIN, SETTLED_LINES);
const OPTIONS = {
  folderSlot: "02 Prijaté faktúry",
  profile: null,
  extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION,
};

test("a detected settlement shows the supply by default", () => {
  const merged = mergeDocumentFields(DETECTED, {}, OPTIONS);
  assert.equal(merged.advanceSettled, true);
  assert.equal(merged.fields.amountLiteral, "448.52");
  assert.equal(merged.advanceSettlement?.source, "detected");
});

test("her not-settled flag restores the plain extraction, and it is not a settlement", () => {
  const merged = mergeDocumentFields(DETECTED, { advanceSettlement: { settled: false, source: "manual" } }, OPTIONS);
  assert.equal(merged.advanceSettled, false);
  assert.equal(merged.advanceSettlement, null);
  assert.equal(merged.fields.amountLiteral, "0.00");
  assert.equal(merged.fields.amountCents, 0);
  assert.deepEqual(merged.fields.vatRecap.map((r) => [r.baseCents, r.vatCents]), [[36465, 8387]]);
  assert.equal(merged.fields.recapVatLiteral, "83.87");
});

test("her settled flag applies the settlement to an invoice the pipeline did not detect", () => {
  const merged = mergeDocumentFields(PLAIN, { advanceSettlement: { settled: true, source: "manual" } }, OPTIONS);
  assert.equal(merged.advanceSettled, true);
  assert.equal(merged.fields.amountLiteral, "448.52");
  assert.equal(merged.provenance.amountLiteral, "derived");
  assert.equal(merged.advanceSettlement?.source, "manual");
  assert.equal(merged.advanceSettlement?.amountDueCents, 0);
  assert.equal(merged.fields.recapVatLiteral, "83.87");
});

test("an unset flag on an undetected invoice leaves it plain, as before", () => {
  const merged = mergeDocumentFields(PLAIN, {}, OPTIONS);
  assert.equal(merged.advanceSettled, false);
  assert.equal(merged.fields.amountLiteral, "0.00");
});

test("her flag survives a fresh extraction that reads the document the other way", () => {
  const confirmed: ConfirmedPayload = { advanceSettlement: { settled: false, source: "manual" } };
  // A re-read detects the settlement again: the flag still decides.
  assert.equal(mergeDocumentFields(DETECTED, confirmed, OPTIONS).advanceSettled, false);
  // A re-read that no longer shows the settlement: the flag still decides the other way.
  const settled: ConfirmedPayload = { advanceSettlement: { settled: true, source: "manual" } };
  const reread = mergeDocumentFields(PLAIN, settled, OPTIONS);
  assert.equal(reread.advanceSettled, true);
  assert.equal(reread.fields.amountLiteral, "448.52");
});

test("a value she typed outranks the flag", () => {
  const confirmed: ConfirmedPayload = {
    advanceSettlement: { settled: false, source: "manual" },
    amountLiteral: "100.00",
    amountCents: 10000,
  };
  const merged = mergeDocumentFields(DETECTED, confirmed, OPTIONS);
  assert.equal(merged.fields.amountLiteral, "100.00");
  assert.equal(merged.provenance.amountLiteral, "confirmed");
});
