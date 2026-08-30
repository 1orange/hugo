import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkArithmeticWarning,
  mergeDocumentFields,
  parseConfirmedFieldsFromInput,
  type DocumentFieldFormInput,
} from "../../../src/modules/document-fields.ts";
import type { EkasaExtractedPayload } from "../../../src/modules/document-payload.ts";
import { emptyConfirmedPayload } from "../../../src/modules/document-payload.ts";

const extracted: EkasaExtractedPayload = {
  kind: "ekasa",
  amountCents: 1685,
  amountLiteral: "16.85",
  currency: "EUR",
  receiptAt: "2026-04-16T12:05:59.000Z",
  receiptTimestampRaw: "16.04.2026 14:05:59",
  ekasaUid: "uid",
  ekasaOkp: "okp",
  supplierName: "Extracted Shop",
  dic: "1234567890",
  ico: "12345678",
  icDph: "SK1234567890",
  kp: "888",
  receiptNumber: "100",
  recapBaseCents: 1370,
  recapBaseLiteral: "13.70",
  recapVatCents: 315,
  recapVatLiteral: "3.15",
  lineItems: [],
  vatRecap: [
    {
      rateLiteral: "23.0",
      baseLiteral: "13.70",
      baseCents: 1370,
      vatLiteral: "3.15",
      vatCents: 315,
    },
  ],
};

test("mergeDocumentFields prefers confirmed values over extracted", () => {
  const merged = mergeDocumentFields(extracted, {
    supplierName: "Her Shop",
    amountLiteral: "20.00",
    amountCents: 2000,
  });

  assert.equal(merged.fields.supplierName, "Her Shop");
  assert.equal(merged.provenance.supplierName, "confirmed");
  assert.equal(merged.fields.amountLiteral, "20.00");
  assert.equal(merged.provenance.amountLiteral, "confirmed");
  assert.equal(merged.fields.dic, "1234567890");
  assert.equal(merged.provenance.dic, "extracted");
});

test("mergeDocumentFields starts empty when extraction failed", () => {
  const merged = mergeDocumentFields({}, emptyConfirmedPayload());
  assert.equal(merged.fields.supplierName, "");
  assert.equal(merged.provenance.supplierName, "empty");
});

test("parseConfirmedFieldsFromInput rejects non-numeric amounts", () => {
  const input: DocumentFieldFormInput = {
    supplierName: "Shop",
    ico: "",
    dic: "",
    icDph: "",
    receiptNumber: "",
    receiptTimestampRaw: "",
    currency: "EUR",
    amountLiteral: "not-a-number",
    recapBaseLiteral: "",
    recapVatLiteral: "",
    vatRecap: [],
  };
  const result = parseConfirmedFieldsFromInput(input);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /amount/i);
  }
});

test("parseConfirmedFieldsFromInput preserves money literals", () => {
  const input: DocumentFieldFormInput = {
    supplierName: "Shop",
    ico: "12345678",
    dic: "1234567890",
    icDph: "SK1234567890",
    receiptNumber: "42",
    receiptTimestampRaw: "16.04.2026 14:05:59",
    currency: "EUR",
    amountLiteral: "16.85",
    recapBaseLiteral: "13.70",
    recapVatLiteral: "3.15",
    vatRecap: [{ rateLiteral: "23.0", baseLiteral: "13.70", vatLiteral: "3.15" }],
  };
  const result = parseConfirmedFieldsFromInput(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.amountLiteral, "16.85");
    assert.equal(result.payload.amountCents, 1685);
    assert.equal(result.payload.recapBaseLiteral, "13.70");
    assert.equal(result.payload.vatRecap?.[0]?.vatLiteral, "3.15");
    assert.equal(result.payload.receiptAt, "2026-04-16T12:05:59.000Z");
  }
});

test("a date without a time is accepted, as invoices carry no time", () => {
  const input: DocumentFieldFormInput = {
    supplierName: "Supplier s.r.o.",
    ico: "",
    dic: "",
    icDph: "",
    receiptNumber: "2026001",
    receiptTimestampRaw: "16.04.2026",
    currency: "EUR",
    amountLiteral: "1 234".replace(" ", ""),
    recapBaseLiteral: "",
    recapVatLiteral: "",
    vatRecap: [],
  };
  const result = parseConfirmedFieldsFromInput(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.receiptTimestampRaw, "16.04.2026");
    // Local midnight in Bratislava, which is summer time in April.
    assert.equal(result.payload.receiptAt, "2026-04-15T22:00:00.000Z");
  }
});

test("she can type amounts with a comma", () => {
  const input: DocumentFieldFormInput = {
    supplierName: "Shop",
    ico: "",
    dic: "",
    icDph: "",
    receiptNumber: "",
    receiptTimestampRaw: "",
    currency: "EUR",
    amountLiteral: "16,85",
    recapBaseLiteral: "13,70",
    recapVatLiteral: "3,15",
    vatRecap: [],
  };
  const result = parseConfirmedFieldsFromInput(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.amountCents, 1685);
    assert.equal(result.payload.recapBaseCents, 1370);
    assert.equal(result.payload.recapVatCents, 315);
  }
});

test("checkArithmeticWarning reports mismatch but does not block", () => {
  const warning = checkArithmeticWarning({
    supplierName: "",
    ico: "",
    dic: "",
    icDph: "",
    receiptNumber: "",
    receiptTimestampRaw: "",
    receiptAt: null,
    currency: "EUR",
    amountLiteral: "16.85",
    amountCents: 1685,
    recapBaseLiteral: "13.70",
    recapBaseCents: 1370,
    recapVatLiteral: "3.00",
    recapVatCents: 300,
    vatRecap: [],
  });
  assert.ok(warning);
  assert.match(warning!, /16\.85/);
});

test("checkArithmeticWarning is silent when base plus vat equals total", () => {
  const warning = checkArithmeticWarning({
    supplierName: "",
    ico: "",
    dic: "",
    icDph: "",
    receiptNumber: "",
    receiptTimestampRaw: "",
    receiptAt: null,
    currency: "EUR",
    amountLiteral: "16.85",
    amountCents: 1685,
    recapBaseLiteral: "13.70",
    recapBaseCents: 1370,
    recapVatLiteral: "3.15",
    recapVatCents: 315,
    vatRecap: [],
  });
  assert.equal(warning, null);
});
