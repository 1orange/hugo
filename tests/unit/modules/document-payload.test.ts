import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEkasaPayload,
  isModelExtractedPayload,
  parseExtractedPayload,
  serializeExtractedPayload,
  type ModelExtractedPayload,
} from "../../../src/modules/document-payload.ts";

const sample: ModelExtractedPayload = {
  kind: "extracted",
  source: "model",
  parties: [
    { name: "Dodávateľ s.r.o.", ico: "87654321", dic: "8765432100", icDph: "SK8765432100" },
    { name: "Beta s.r.o.", ico: "31333532", dic: "2020311335", icDph: "SK7120001713" },
  ],
  documentNumber: "20260042",
  variableSymbol: "20260042",
  issueDate: "2026-04-16",
  taxableSupplyDate: "2026-04-16",
  dueDate: "2026-04-30",
  currency: "EUR",
  amountCents: 12300,
  amountLiteral: "123.00",
  vatRecap: [
    {
      rateLiteral: "23",
      baseLiteral: "100.00",
      baseCents: 10000,
      vatLiteral: "23.00",
      vatCents: 2300,
    },
  ],
  docTypeHint: "invoice",
};

test("parseExtractedPayload round-trips model extracted payload", () => {
  const json = serializeExtractedPayload(sample);
  const parsed = parseExtractedPayload(json);
  assert.equal(isModelExtractedPayload(parsed), true);
  if (isModelExtractedPayload(parsed)) {
    assert.equal(parsed.documentNumber, "20260042");
    assert.equal(parsed.parties.length, 2);
    assert.equal(parsed.parties[1]?.ico, "31333532");
  }
});

test("parseExtractedPayload still recognises ekasa", () => {
  const json = serializeExtractedPayload({
    kind: "ekasa",
    amountCents: 100,
    amountLiteral: "1.00",
    currency: "EUR",
    receiptAt: null,
    receiptTimestampRaw: null,
    ekasaUid: null,
    ekasaOkp: null,
    supplierName: null,
    dic: null,
    ico: null,
    icDph: null,
    kp: null,
    receiptNumber: null,
    recapBaseCents: null,
    recapBaseLiteral: null,
    recapVatCents: null,
    recapVatLiteral: null,
    lineItems: [],
    vatRecap: [],
  });
  assert.equal(isEkasaPayload(parseExtractedPayload(json)), true);
});

test("corrupt extracted json renders as empty payload", () => {
  assert.deepEqual(parseExtractedPayload("{"), {});
  assert.deepEqual(parseExtractedPayload("[]"), {});
});
