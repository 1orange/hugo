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

// Kaspersky and Bonami: the register's total includes VAT she self-assessed,
// which the invoice never prints, so the model's (correct) total differs.
test("B1 documents do not score the total either", () => {
  const label = syntheticLabel({ kvDphSection: "B1", amountCents: 3200, amountLiteral: "32.00" });
  const payload = extracted({ amountCents: 2602, amountLiteral: "26.02" });
  const byField = new Map(
    scoreBenchmarkDocument({ label, payload }).fields.map((field) => [field.field, field.outcome]),
  );
  assert.equal(byField.get("amountCents"), "skipped");
});

test("a model that returns no recap rows scores the recap empty, not zero", () => {
  const score = scoreBenchmarkDocument({ label: syntheticLabel({}), payload: extracted({ vatRecap: [] }) });
  for (const key of ["vatRecapBase", "vatRecapVat", "vatRecapTotal"] as const) {
    const field = score.fields.find((candidate) => candidate.field === key)!;
    assert.equal(field.outcome, "empty", key);
    assert.equal(field.actual, null, key);
  }
});

// The bar is "correct, flagged or empty — never silently wrong": a wrong value
// the checks flagged is visible to her, so it is not wrong-but-plausible.
test("a wrong value the checks flagged is not counted as wrong-but-plausible", () => {
  const label = syntheticLabel({});
  const payload = extracted({
    parties: [{ name: "Supplier s.r.o.", ico: "12345679", dic: null, icDph: null }],
  });
  const score = scoreBenchmarkDocument({
    label,
    payload,
    fieldCheckStates: { counterpartyIco: "flagged" },
  });
  const ico = score.fields.find((field) => field.field === "counterpartyIco")!;
  assert.equal(ico.outcome, "wrong_flagged");

  const aggregate = aggregateBenchmarkScores({
    documents: [score],
    payloadsByDriveFileId: { [label.driveFileId]: payload },
  });
  const wrongPlausibleFields = score.fields.filter((field) => field.outcome === "wrong_plausible").length;
  assert.equal(aggregate.adoptionBar.wrongPlausible, wrongPlausibleFields);
});

test("IČ DPH is compared without spacing, as the register prints it spaced", () => {
  const label = syntheticLabel({
    supplier: { name: "Poradca", ico: null, dic: null, icDph: "SK 2020449189" },
  });
  const payload = extracted({
    parties: [{ name: "Poradca", ico: null, dic: null, icDph: "SK2020449189" }],
  });
  const icDph = scoreBenchmarkDocument({ label, payload }).fields.find(
    (field) => field.field === "counterpartyIcDph",
  )!;
  assert.equal(icDph.outcome, "exact");
});

// Production takes whichever party is not her client (ADR 0018); scoring took
// the first party listed, which small models often make the client itself.
test("a counterparty name matches her shorthand without the legal form", () => {
  const scoreName = (labelName: string, modelName: string) =>
    scoreBenchmarkDocument({
      label: syntheticLabel({ supplier: { name: labelName, ico: "12345678", dic: null, icDph: null } }),
      payload: extracted({ parties: [{ name: modelName, ico: "12345678", dic: null, icDph: null }] }),
    }).fields.find((field) => field.field === "counterpartyName")!.outcome;
  assert.equal(scoreName("O2 Slovakia", "O2 Slovakia, s.r.o."), "exact");
  assert.equal(scoreName("Alza.sk", "Alza.sk s.r.o."), "exact");
  assert.equal(scoreName("Tomizo, s. r. o.", "TOMIZO s.r.o."), "exact");
  assert.equal(scoreName("UPC BROADBAND", "SPRING.etc., spol. s r. o."), "wrong_plausible");
});

test("the counterparty is the party that is not the company, as in production", () => {
  const label = syntheticLabel({
    supplier: { name: "Poradca", ico: null, dic: null, icDph: null },
  });
  const payload = extracted({
    parties: [
      { name: "SPRING.etc., spol. s r. o.", ico: "45891761", dic: null, icDph: null },
      { name: "Poradca", ico: null, dic: null, icDph: null },
    ],
  });
  const name = scoreBenchmarkDocument({ label, payload, companyIco: "45 891 761" }).fields.find(
    (field) => field.field === "counterpartyName",
  )!;
  assert.equal(name.outcome, "exact");
});

test("when no party carries the company's IČO, the counterparty is flagged, as production flags the roles", async () => {
  const { benchmarkFieldCheckStates } = await import(
    "../../../src/modules/extraction-checks-benchmark.ts"
  );
  const label = syntheticLabel({ supplier: { name: "Poradca", ico: null, dic: null, icDph: null } });
  const payload = extracted({
    parties: [
      { name: "SPRING.etc., spol. s r. o.", ico: null, dic: null, icDph: null },
      { name: "Poradca", ico: null, dic: null, icDph: null },
    ],
  });
  const flags = {
    documentNumber: "correct", variableSymbol: "correct", issueDate: "correct",
    taxableSupplyDate: "correct", dueDate: "correct", currency: "correct",
    amountCents: "correct", vatRecap: "correct",
    parties: payload.parties.map(() => ({ name: "correct", ico: "empty", dic: "empty", icDph: "empty" })),
  } as const;
  const states = benchmarkFieldCheckStates(flags as never, label, payload, "45891761");
  assert.equal(states.counterpartyName, "flagged");
});
