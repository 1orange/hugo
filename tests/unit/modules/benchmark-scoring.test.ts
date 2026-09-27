import { test } from "node:test";
import assert from "node:assert/strict";
import type { BenchmarkLabel } from "../../../src/modules/benchmark-label.ts";
import {
  aggregateBenchmarkScores,
  scoreBenchmarkDocument,
} from "../../../src/modules/benchmark-scoring.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";

function syntheticLabel(partial: Partial<BenchmarkLabel>): BenchmarkLabel {
  return {
    driveFileId: "drive-1",
    monthKey: "2026_05",
    side: "received",
    folderSlot: "02 Prijaté faktúry",
    kvDphSection: "B2",
    docTypeHint: "invoice",
    documentNumber: "INV-1",
    variableSymbol: "INV-1",
    issueDate: "2026-05-07",
    taxableSupplyDate: "2026-05-07",
    dueDate: null,
    currency: "EUR",
    amountCents: 3300,
    amountLiteral: "33.00",
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "26.83",
        baseCents: 2683,
        vatLiteral: "6.17",
        vatCents: 617,
      },
    ],
    supplier: { name: "Supplier s.r.o.", ico: "12345678", dic: null, icDph: "SK1234567890" },
    customer: { name: null, ico: null, dic: null, icDph: null },
    ...partial,
  };
}

function extracted(partial: Partial<ModelExtractedPayload>): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [],
    documentNumber: null,
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: null,
    amountLiteral: null,
    vatRecap: [],
    docTypeHint: "invoice",
    ...partial,
  };
}

test("B1 documents score base only and skip VAT amounts", () => {
  const label = syntheticLabel({
    kvDphSection: "B1",
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "26.02",
        baseCents: 2602,
        vatLiteral: "5.98",
        vatCents: 598,
      },
    ],
    amountCents: 3200,
    amountLiteral: "32.00",
  });
  const payload = extracted({
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "26.02",
        baseCents: 2602,
        vatLiteral: "9.99",
        vatCents: 999,
      },
    ],
    amountCents: 3601,
    amountLiteral: "36.01",
  });

  const score = scoreBenchmarkDocument({ label, payload });
  const byField = new Map(score.fields.map((field) => [field.field, field.outcome]));

  assert.equal(byField.get("vatRecapBase"), "exact");
  assert.equal(byField.get("vatRecapVat"), "skipped");
  assert.equal(byField.get("vatRecapTotal"), "skipped");
});

test("receipt date mismatches are not scored", () => {
  const label = syntheticLabel({
    docTypeHint: "receipt",
    side: "received",
    issueDate: "2026-05-01",
    taxableSupplyDate: "2026-05-01",
  });
  const payload = extracted({
    issueDate: "2026-04-30",
    taxableSupplyDate: "2026-04-30",
    dueDate: "2026-04-30",
  });

  const score = scoreBenchmarkDocument({ label, payload });
  for (const field of ["issueDate", "taxableSupplyDate", "dueDate"] as const) {
    const row = score.fields.find((entry) => entry.field === field);
    assert.equal(row?.outcome, "skipped", field);
  }
});

test("adoption bar passes when extracted values match the label", () => {
  const label = syntheticLabel({});
  const payload = extracted({
    documentNumber: "INV-1",
    variableSymbol: "INV-1",
    issueDate: "2026-05-07",
    taxableSupplyDate: "2026-05-07",
    currency: "EUR",
    amountCents: 3300,
    amountLiteral: "33.00",
    vatRecap: label.vatRecap,
    parties: [
      {
        name: "Supplier s.r.o.",
        ico: "12345678",
        dic: null,
        icDph: "SK1234567890",
      },
    ],
  });
  const documentScore = scoreBenchmarkDocument({ label, payload });
  const aggregate = aggregateBenchmarkScores({
    documents: [documentScore],
    payloadsByDriveFileId: { "drive-1": payload },
  });
  assert.equal(aggregate.adoptionBar.passesAmountRule, true);
  assert.equal(aggregate.adoptionBar.passesAccuracyRule, true);
  assert.equal(aggregate.adoptionBar.passesWrongPlausibleRule, true);
  assert.equal(aggregate.adoptionBar.passes, true);
});
