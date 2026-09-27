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

function formInput(
  partial: Partial<DocumentFieldFormInput>,
): DocumentFieldFormInput {
  return {
    exportSection: "",
    supplierName: "",
    ico: "",
    dic: "",
    icDph: "",
    customerName: "",
    customerIco: "",
    customerDic: "",
    customerIcDph: "",
    documentNumber: "",
    variableSymbol: "",
    issueDateRaw: "",
    taxableSupplyDateRaw: "",
    dueDateRaw: "",
    receiptNumber: "",
    receiptTimestampRaw: "",
    currency: "EUR",
    amountLiteral: "",
    recapBaseLiteral: "",
    recapVatLiteral: "",
    vatRecap: [],
    ...partial,
  };
}

const emptyEditableFields = {
  supplierName: "",
  ico: "",
  dic: "",
  icDph: "",
  customerName: "",
  customerIco: "",
  customerDic: "",
  customerIcDph: "",
  documentNumber: "",
  variableSymbol: "",
  issueDateRaw: "",
  issueDateAt: null,
  taxableSupplyDateRaw: "",
  taxableSupplyDateAt: null,
  dueDateRaw: "",
  dueDateAt: null,
  receiptNumber: "",
  receiptTimestampRaw: "",
  receiptAt: null,
  currency: "EUR",
  amountLiteral: "",
  amountCents: null,
  recapBaseLiteral: "",
  recapBaseCents: null,
  recapVatLiteral: "",
  recapVatCents: null,
  vatRecap: [] as EkasaExtractedPayload["vatRecap"],
};

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

test("mergeDocumentFields flags foreign currency against home currency", () => {
  const czkDoc = { ...extracted, currency: "CZK" };
  assert.equal(mergeDocumentFields(czkDoc, emptyConfirmedPayload()).nonEurCurrency, true);
  assert.equal(
    mergeDocumentFields(czkDoc, emptyConfirmedPayload(), { homeCurrency: "CZK" })
      .nonEurCurrency,
    false,
  );
  assert.equal(
    mergeDocumentFields(extracted, emptyConfirmedPayload(), { homeCurrency: "CZK" })
      .nonEurCurrency,
    true,
  );
  assert.equal(
    mergeDocumentFields(czkDoc, emptyConfirmedPayload(), {
      profile: { country: "CZ", ico: "87654321", icDph: "" },
    }).nonEurCurrency,
    false,
  );
});

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
  const input = formInput({ supplierName: "Shop", amountLiteral: "not-a-number" });
  const result = parseConfirmedFieldsFromInput(input);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /amount/i);
  }
});

test("parseConfirmedFieldsFromInput preserves money literals", () => {
  const input = formInput({
    supplierName: "Shop",
    ico: "12345678",
    dic: "1234567890",
    icDph: "SK1234567890",
    receiptNumber: "42",
    receiptTimestampRaw: "16.04.2026 14:05:59",
    amountLiteral: "16.85",
    recapBaseLiteral: "13.70",
    recapVatLiteral: "3.15",
    vatRecap: [{ rateLiteral: "23.0", baseLiteral: "13.70", vatLiteral: "3.15" }],
  });
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
  const input = formInput({
    supplierName: "Supplier s.r.o.",
    receiptNumber: "2026001",
    receiptTimestampRaw: "16.04.2026",
    amountLiteral: "1234",
  });
  const result = parseConfirmedFieldsFromInput(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.receiptTimestampRaw, "16.04.2026");
    // Local midnight in Bratislava, which is summer time in April.
    assert.equal(result.payload.receiptAt, "2026-04-15T22:00:00.000Z");
  }
});

test("she can type amounts with a comma", () => {
  const input = formInput({
    supplierName: "Shop",
    amountLiteral: "16,85",
    recapBaseLiteral: "13,70",
    recapVatLiteral: "3,15",
  });
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
    ...emptyEditableFields,
    amountLiteral: "16.85",
    amountCents: 1685,
    recapBaseLiteral: "13.70",
    recapBaseCents: 1370,
    recapVatLiteral: "3.00",
    recapVatCents: 300,
  });
  assert.ok(warning);
  assert.match(warning!, /16\.85/);
});

test("ekasa receipt date fills issue date and DUZP", () => {
  const merged = mergeDocumentFields(extracted, emptyConfirmedPayload());
  assert.equal(merged.fields.issueDateRaw, "16.04.2026");
  assert.equal(merged.fields.taxableSupplyDateRaw, "16.04.2026");
  assert.equal(merged.fields.issueDateAt, extracted.receiptAt);
});

test("model extracted parties derive roles for received invoices", () => {
  const merged = mergeDocumentFields(
    {
      kind: "extracted",
      parties: [
        { name: "Dodávateľ s.r.o.", ico: "87654321", dic: null, icDph: "SK8765432100" },
        { name: "Beta s.r.o.", ico: "31333532", dic: null, icDph: "SK7120001713" },
      ],
      documentNumber: "2026001",
      variableSymbol: "2026001",
      issueDate: "2026-04-16",
      taxableSupplyDate: "2026-04-16",
      dueDate: "2026-04-30",
      currency: "EUR",
      amountCents: 12300,
      amountLiteral: "123.00",
      vatRecap: [],
      docTypeHint: "invoice",
    },
    emptyConfirmedPayload(),
    {
      folderSlot: "02 Prijaté faktúry",
      profile: { country: "SK", ico: "31333532", icDph: "SK7120001713" },
    },
  );
  assert.equal(merged.fields.customerName, "Beta s.r.o.");
  assert.equal(merged.fields.supplierName, "Dodávateľ s.r.o.");
  assert.equal(merged.rolesFlagged, false);
});

test("checkArithmeticWarning flags multi-rate totals in Slovak", () => {
  const warning = checkArithmeticWarning({
    ...emptyEditableFields,
    amountLiteral: "123.00",
    amountCents: 12300,
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "80.00",
        baseCents: 8000,
        vatLiteral: "18.40",
        vatCents: 1840,
      },
      {
        rateLiteral: "5",
        baseLiteral: "20.00",
        baseCents: 2000,
        vatLiteral: "1.00",
        vatCents: 100,
      },
    ],
  });
  assert.ok(warning);
  assert.match(warning!, /Súčet základov DPH/);
});

test("checkArithmeticWarning is silent when base plus vat equals total", () => {
  const warning = checkArithmeticWarning({
    ...emptyEditableFields,
    amountLiteral: "16.85",
    amountCents: 1685,
    recapBaseLiteral: "13.70",
    recapBaseCents: 1370,
    recapVatLiteral: "3.15",
    recapVatCents: 315,
  });
  assert.equal(warning, null);
});
