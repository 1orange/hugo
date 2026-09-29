import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runExtractionChecks,
  type ExtractionChecksInput,
} from "../../../src/modules/extraction-checks.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";

function source(lines: string[]): string[] {
  return lines;
}

function basePayload(partial: Partial<ModelExtractedPayload>): ModelExtractedPayload {
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

function run(
  payload: ModelExtractedPayload,
  textLines: string[],
  extra?: Partial<Omit<ExtractionChecksInput, "payload" | "sourceTextLines">>,
) {
  return runExtractionChecks({
    payload,
    sourceTextLines: textLines,
    monthKey: "2026_05",
    issuerCountry: "SK",
    ...extra,
  });
}

test("arithmetic passes when recap sums match total", () => {
  const payload = basePayload({
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
  });
  const result = run(payload, source(["Total 33.00 EUR"]));
  assert.equal(result.flags.amountCents, "correct");
  assert.equal(result.flags.vatRecap, "correct");
});

test("arithmetic flags when recap sum disagrees with total", () => {
  const payload = basePayload({
    amountCents: 3300,
    amountLiteral: "33.00",
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "26.83",
        baseCents: 2683,
        vatLiteral: "6.17",
        vatCents: 600,
      },
    ],
  });
  const result = run(payload, source(["33.00"]));
  assert.equal(result.flags.amountCents, "flagged");
  assert.equal(result.flags.vatRecap, "flagged");
});

test("arithmetic flags when VAT amount does not match rate", () => {
  const payload = basePayload({
    amountCents: 12300,
    amountLiteral: "123.00",
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "100.00",
        baseCents: 10000,
        vatLiteral: "20.00",
        vatCents: 2000,
      },
    ],
  });
  const result = run(payload, source(["123.00"]));
  assert.equal(result.flags.vatRecap, "flagged");
});

test("grounding drops IČO not present in source text", () => {
  const payload = basePayload({
    parties: [{ name: "Shop", ico: "31333532", dic: null, icDph: null }],
  });
  const result = run(payload, source(["Dodávateľ bez IČO"]));
  assert.equal(result.payload.parties[0]?.ico, null);
  assert.equal(result.flags.parties[0]?.ico, "empty");
});

test("grounding keeps IČO that appears in source text", () => {
  const payload = basePayload({
    parties: [{ name: "Shop", ico: "31333532", dic: null, icDph: null }],
  });
  const result = run(payload, source(["IČO: 31333532"]));
  assert.equal(result.payload.parties[0]?.ico, "31333532");
  assert.equal(result.flags.parties[0]?.ico, "correct");
});

test("format flags invalid IČO checksum", () => {
  const payload = basePayload({
    parties: [{ name: "Shop", ico: "31333531", dic: null, icDph: null }],
  });
  const result = run(payload, source(["IČO 31333531"]));
  assert.equal(result.payload.parties[0]?.ico, "31333531");
  assert.equal(result.flags.parties[0]?.ico, "flagged");
});

test("format flags invalid Slovak IČ DPH", () => {
  const payload = basePayload({
    parties: [{ name: "Shop", ico: null, dic: null, icDph: "SK123" }],
  });
  const result = run(payload, source(["SK123"]));
  assert.equal(result.flags.parties[0]?.icDph, "flagged");
});

test("format flags Czech VAT rate on Slovak issuer", () => {
  const payload = basePayload({
    vatRecap: [
      {
        rateLiteral: "21",
        baseLiteral: "100.00",
        baseCents: 10000,
        vatLiteral: "21.00",
        vatCents: 2100,
      },
    ],
    amountCents: 12100,
    amountLiteral: "121.00",
  });
  const result = run(payload, source(["121.00"]), { issuerCountry: "SK" });
  assert.equal(result.flags.vatRecap, "flagged");
});

test("credit note negative amounts pass arithmetic", () => {
  const payload = basePayload({
    docTypeHint: "credit_note",
    amountCents: -3300,
    amountLiteral: "-33.00",
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "-26.83",
        baseCents: -2683,
        vatLiteral: "-6.17",
        vatCents: -617,
      },
    ],
  });
  const result = run(payload, source(["Dobropis -33.00"]));
  assert.equal(result.flags.amountCents, "correct");
  assert.equal(result.flags.vatRecap, "correct");
});

test("format flags issue date far from document month", () => {
  const payload = basePayload({
    issueDate: "2024-01-15",
  });
  const result = run(payload, source(["15.01.2024"]), { monthKey: "2026_05" });
  assert.equal(result.flags.issueDate, "flagged");
});

function recapRow(rateLiteral: string, baseCents: number, vatCents: number) {
  return {
    rateLiteral,
    baseLiteral: (baseCents / 100).toFixed(2),
    baseCents,
    vatLiteral: (vatCents / 100).toFixed(2),
    vatCents,
  };
}

test("a Czech cash receipt rounded to the whole koruna passes the arithmetic check", () => {
  // 82.31 + 17.29 = 99.60 Kč, paid 100 Kč in cash.
  const payload = basePayload({
    currency: "CZK",
    amountCents: 10000,
    amountLiteral: "100.00",
    vatRecap: [recapRow("21", 8231, 1729)],
    docTypeHint: "receipt",
  });
  const result = run(payload, source(["Celkem 100 Kč"]), { issuerCountry: "CZ" });
  assert.equal(result.flags.amountCents, "correct");
  assert.equal(result.flags.vatRecap, "correct");
});

test("a Slovak cash receipt rounded to 5 cents passes the arithmetic check", () => {
  const payload = basePayload({
    amountCents: 1985,
    amountLiteral: "19.85",
    vatRecap: [recapRow("23", 1612, 371)],
    docTypeHint: "receipt",
  });
  const result = run(payload, source(["Spolu 19,85 EUR"]));
  assert.equal(result.flags.amountCents, "correct");
});

test("a difference beyond the cash rounding is still flagged", () => {
  const payload = basePayload({
    currency: "CZK",
    amountCents: 10100,
    amountLiteral: "101.00",
    vatRecap: [recapRow("21", 8231, 1729)],
  });
  const result = run(payload, source(["101"]), { issuerCountry: "CZ" });
  assert.equal(result.flags.amountCents, "flagged");
});

// Seen from Qwen3 0.6B: `563,96 EUR` did not parse, the row became 0 cents and
// passed as correct because the total was empty too.
test("a recap literal that does not match its cents is flagged", () => {
  const payload = basePayload({
    vatRecap: [
      { rateLiteral: "23", baseLiteral: "563,96 EUR", baseCents: 0, vatLiteral: "122,69 EUR", vatCents: 0 },
    ],
  });
  assert.equal(run(payload, source(["563,96 EUR"])).flags.vatRecap, "flagged");
});

test("a row's VAT is checked against its rate even when the total was not read", () => {
  const payload = basePayload({ vatRecap: [recapRow("23", 56396, 12269)] });
  assert.equal(run(payload, source(["563,96"])).flags.vatRecap, "flagged");
});

// A receipt has one seller; on an invoice one IČO twice is a mistake to see.
test("parties sharing an IČO are merged among the receipts only", async () => {
  const { runExtractionChecks } = await import("../../../src/modules/extraction-checks.ts");
  const seller = { name: "Stanica Nivy s.r.o.", ico: "50861930", dic: null, icDph: "SK2120532249" };
  const plate = { name: "BA123XY", ico: "50861930", dic: null, icDph: "SK2120532249" };
  const payload = {
    kind: "extracted" as const,
    parties: [seller, plate],
    documentNumber: "12345",
    variableSymbol: null,
    issueDate: "2026-07-23",
    taxableSupplyDate: "2026-07-23",
    dueDate: null,
    currency: "EUR",
    amountCents: 300,
    amountLiteral: "3,00",
    vatRecap: [],
    docTypeHint: "receipt" as const,
  };
  const lines = ["Stanica Nivy s.r.o.", "IČO: 50 861 930", "IČ DPH: SK2120532249", "BA123XY", "Spolu s DPH | €3,00"];
  const run = (folderSlot: string) =>
    runExtractionChecks({ payload, sourceTextLines: lines, monthKey: "2026_07", folderSlot }).payload.parties.length;
  assert.equal(run("05 Bločky_firemná karta"), 1);
  assert.equal(run("02 Prijaté faktúry"), 2);
});
