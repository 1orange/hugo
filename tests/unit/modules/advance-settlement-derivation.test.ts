import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDocumentFields } from "../../../src/modules/document-fields.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
import { deriveVat, type VatMoney } from "../../../src/modules/vat-derivation.ts";
import type {
  AdvanceSettlementPayload,
  ConfirmedPayload,
  DocumentVatRecapRow,
  ModelExtractedPayload,
} from "../../../src/modules/document-payload.ts";

const SETTLEMENT_ROW: DocumentVatRecapRow = {
  rateLiteral: "23",
  baseLiteral: "-32.51",
  baseCents: -3251,
  vatLiteral: "-7.48",
  vatCents: -748,
};

function settlement(
  totalProvenance: "extracted" | "derived",
  overrides: Partial<AdvanceSettlementPayload> = {},
): AdvanceSettlementPayload {
  return {
    source: "detected",
    totalProvenance,
    advanceDeductedCents: 3999,
    advanceDeductedLiteral: "39.99",
    amountDueCents: 0,
    amountDueLiteral: "0.00",
    advanceDocumentNumbers: ["ZDD15262026"],
    settlementRows: [SETTLEMENT_ROW],
    ...overrides,
  };
}

function settledPayload(
  supply: DocumentVatRecapRow[],
  totalProvenance: "extracted" | "derived",
  overrides: Partial<ModelExtractedPayload> = {},
): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [{ name: "Dodávateľ s.r.o.", ico: null, dic: null, icDph: "SK2020449189" }],
    documentNumber: "VF12262026",
    variableSymbol: null,
    issueDate: "2026-05-03",
    taxableSupplyDate: "2026-05-03",
    dueDate: null,
    currency: "EUR",
    amountCents: 3999,
    amountLiteral: "39.99",
    vatRecap: supply,
    docTypeHint: "invoice",
    advanceSettlement: settlement(totalProvenance),
    ...overrides,
  };
}

const RECEIVED = { folderSlot: "02 Prijaté faktúry", extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION };

const SUPPLY_23: DocumentVatRecapRow = {
  rateLiteral: "23",
  baseLiteral: "32.51",
  baseCents: 3251,
  vatLiteral: "7.48",
  vatCents: 748,
};

test("the VAT summary sums the supply rows and never the settlement rows", () => {
  const merged = mergeDocumentFields(settledPayload([SUPPLY_23], "extracted"), {}, RECEIVED);
  assert.deepEqual(merged.fields.vatRecap.map((row) => row.rateLiteral), ["23"]);
  assert.equal(merged.fields.recapBaseCents, 3251);
  assert.equal(merged.fields.recapVatCents, 748);
  assert.equal(merged.provenance.recapBaseLiteral, "derived");
  assert.equal(merged.provenance.recapVatLiteral, "derived");
  assert.equal(merged.fields.amountCents, 3999);
  assert.equal(merged.advanceSettled, true);
});

test("the VAT summary of a settled zero-rated invoice is the supply, not a cancelled zero", () => {
  const zeroRated: DocumentVatRecapRow = {
    rateLiteral: "0",
    baseLiteral: "43.89",
    baseCents: 4389,
    vatLiteral: "0.00",
    vatCents: 0,
  };
  const merged = mergeDocumentFields(
    settledPayload([zeroRated], "extracted", {
      amountCents: 4389,
      amountLiteral: "43.89",
      advanceSettlement: settlement("extracted", {
        advanceDeductedCents: 4389,
        advanceDeductedLiteral: "43.89",
        settlementRows: [{ ...zeroRated, baseLiteral: "-43.89", baseCents: -4389 }],
      }),
    }),
    {},
    RECEIVED,
  );
  assert.equal(merged.fields.recapBaseCents, 4389);
  assert.equal(merged.fields.recapVatCents, 0);
  assert.equal(merged.fields.amountCents, 4389);
});

test("a printed gross total keeps extracted provenance, a summed total is derived", () => {
  const extracted = mergeDocumentFields(settledPayload([SUPPLY_23], "extracted"), {}, RECEIVED);
  assert.equal(extracted.provenance.amountLiteral, "extracted");
  const derived = mergeDocumentFields(settledPayload([SUPPLY_23], "derived"), {}, RECEIVED);
  assert.equal(derived.provenance.amountLiteral, "derived");
  assert.equal(derived.fields.amountCents, 3999);
});

test("a settled invoice gets no single-rate VAT inference, even with a confirmed base", () => {
  const confirmed: ConfirmedPayload = {
    recapBaseLiteral: "364.65",
    recapBaseCents: 36465,
  };
  const payload = settledPayload([], "extracted", {
    amountCents: 44852,
    amountLiteral: "448.52",
    advanceSettlement: settlement("extracted", {
      advanceDeductedCents: 44852,
      advanceDeductedLiteral: "448.52",
      settlementRows: [],
      advanceDocumentNumbers: ["5926010455"],
    }),
  });
  const settledMerge = mergeDocumentFields(payload, confirmed, RECEIVED);
  assert.deepEqual(settledMerge.fields.vatRecap, []);
  assert.equal(settledMerge.fields.recapVatCents, null);
  assert.equal(settledMerge.provenance.vatRecap, "empty");

  // The same invoice without the settlement is inferred: that is the rule being skipped.
  const plainMerge = mergeDocumentFields({ ...payload, advanceSettlement: undefined }, confirmed, RECEIVED);
  assert.deepEqual(plainMerge.fields.vatRecap.map((row) => row.rateLiteral), ["23"]);
});

test("deriveVat skips single-rate inference when the document is a settlement", () => {
  const money = (cents: number | null, provenance: VatMoney["provenance"]): VatMoney => ({
    cents,
    literal: cents === null ? "" : (cents / 100).toFixed(2),
    provenance,
  });
  const base = {
    amount: money(44852, "extracted"),
    recapBase: money(36465, "confirmed"),
    recapVat: money(null, "empty"),
    vatRecap: [],
    vatRecapProvenance: "empty" as const,
    folderSlot: "02 Prijaté faktúry",
    supplierIcDph: "SK2020449189",
    profileCountry: "SK" as const,
  };
  const inferred = deriveVat(base);
  assert.equal(inferred.vatRecap.length, 1);
  const skipped = deriveVat({ ...base, advanceSettled: true });
  assert.deepEqual(skipped.vatRecap, []);
  assert.equal(skipped.recapVat.cents, null);
});

test("a non-settled invoice keeps the amount provenance it had", () => {
  const plain: ModelExtractedPayload = {
    kind: "extracted",
    source: "model",
    parties: [{ name: "Dodávateľ s.r.o.", ico: null, dic: null, icDph: "SK2020449189" }],
    documentNumber: "2026001",
    variableSymbol: null,
    issueDate: "2026-05-03",
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 12300,
    amountLiteral: "123.00",
    vatRecap: [{ rateLiteral: "23", baseLiteral: "100.00", baseCents: 10000, vatLiteral: "23.00", vatCents: 2300 }],
    docTypeHint: "invoice",
  };
  const merged = mergeDocumentFields(plain, {}, RECEIVED);
  assert.equal(merged.provenance.amountLiteral, "extracted");
  assert.equal(merged.advanceSettled, false);
});
