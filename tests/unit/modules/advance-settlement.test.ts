import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAdvanceOverride,
  applyAdvanceSettlement,
  settleAdvance,
  type AdvanceSettlementResult,
} from "../../../src/modules/advance-settlement.ts";
import type { DocumentVatRecapRow, ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { runExtractionChecks } from "../../../src/modules/extraction-checks.ts";

function row(rate: string, baseCents: number, vatCents: number): DocumentVatRecapRow {
  const format = (cents: number) => (cents / 100).toFixed(2);
  return {
    rateLiteral: rate,
    baseLiteral: format(baseCents),
    baseCents,
    vatLiteral: format(vatCents),
    vatCents,
  };
}

function total(cents: number | null): { cents: number; literal: string } | null {
  return cents === null ? null : { cents, literal: (cents / 100).toFixed(2) };
}

type Expectation = {
  total: { cents: number; provenance: "extracted" | "derived" };
  supply: Array<[string, number, number]>;
  settlement: Array<[string, number, number]>;
  advanceDeducted: number;
  amountDue: number;
  advanceDocumentNumbers: string[];
};

function expectSettled(result: AdvanceSettlementResult, expected: Expectation, label: string) {
  assert.equal(result.settled, true, label);
  if (!result.settled) return;
  assert.equal(result.total.cents, expected.total.cents, `${label}: total`);
  assert.equal(result.total.provenance, expected.total.provenance, `${label}: total provenance`);
  assert.deepEqual(
    result.supplyRows.map((r) => [r.rateLiteral, r.baseCents, r.vatCents]),
    expected.supply,
    `${label}: supply rows`,
  );
  assert.deepEqual(
    result.settlementRows.map((r) => [r.rateLiteral, r.baseCents, r.vatCents]),
    expected.settlement,
    `${label}: settlement rows`,
  );
  assert.equal(result.advanceDeducted.cents, expected.advanceDeducted, `${label}: advance deducted`);
  assert.equal(result.amountDue.cents, expected.amountDue, `${label}: amount due`);
  assert.deepEqual(result.advanceDocumentNumbers, expected.advanceDocumentNumbers, `${label}: advance documents`);
}

type Case = {
  name: string;
  lines: string[];
  total: number | null;
  vatRecap: DocumentVatRecapRow[];
  currency?: string;
  expect: Expectation | "not settled";
};

const CASES: Case[] = [
  {
    name: "advance printed as negative recap rows at 0% (Zál. daň. dokl.)",
    lines: [
      "Odpočet zálohového daňového dokladu ZDD15873826",
      "1,00 | 0,00 | 0,00 | -43,89 | -43,89",
      "Rekapitulácia DPH v | €",
      "Základ 0% | 43,89 | DPH 0% | 0,00",
      "Zál. daň. dokl. základ 0% | -43,89 | DPH 0% | 0,00",
      "Celkom k úhrade | 43,89",
      "Zostáva uhradiť [€]",
      "0,00",
    ],
    total: 0,
    vatRecap: [row("0", 4389, 0)],
    expect: {
      total: { cents: 4389, provenance: "extracted" },
      supply: [["0", 4389, 0]],
      settlement: [["0", -4389, 0]],
      advanceDeducted: 4389,
      amountDue: 0,
      advanceDocumentNumbers: ["ZDD15873826"],
    },
  },
  {
    name: "advance printed as negative recap rows at 23% with the model's rows including the cancelling pair",
    lines: [
      "Odpočet zálohového daňového dokladu ZDD15262026",
      "Základ 23% | 32,51 | DPH 23% | 7,48",
      "Zál. daň. dokl. základ 23% | -32,51 | DPH 23% | -7,48",
      "Zálohy celkom | 39,99",
      "Základ celkom | 0,00 | Celkom DPH | 0,00",
    ],
    total: 0,
    vatRecap: [row("23", 3251, 748), row("23", -3251, -748)],
    expect: {
      total: { cents: 3999, provenance: "derived" },
      supply: [["23", 3251, 748]],
      settlement: [["23", -3251, -748]],
      advanceDeducted: 3999,
      amountDue: 0,
      advanceDocumentNumbers: ["ZDD15262026"],
    },
  },
  {
    name: "full recap followed by Celkom uhradených záloh and Celkom k úhrade vrátane DPH 0,00",
    lines: [
      "Rekapitulácia DPH daňového dokladu 5022606206",
      "Sadzba | Základ DPH | Čiastka DPH | Celkom s DPH",
      "23% | 364,65 | 83,87 | 448,52",
      "Celkom | 364,65 | 83,87 | 448,52",
      "Celková hodnota plnenia: | 448,52 EUR",
      "Celkom uhradených záloh: | 448,52 EUR",
      "Zálohové doklady č. : 5926010455 | 448,52 | EUR",
      "Celkom k úhrade vrátane DPH | 0,00 | EUR",
    ],
    total: 0,
    vatRecap: [row("23", 36465, 8387)],
    expect: {
      total: { cents: 44852, provenance: "extracted" },
      supply: [["23", 36465, 8387]],
      settlement: [],
      advanceDeducted: 44852,
      amountDue: 0,
      advanceDocumentNumbers: ["5926010455"],
    },
  },
  {
    name: "partial advance leaves an amount due",
    lines: [
      "Odpočet zálohového daňového dokladu ZDD15000001",
      "Zál. daň. dokl. základ 23% | -50,00 | DPH 23% | -11,50",
      "Základ 23% | 100,00 | DPH 23% | 23,00",
      "Celkom | 100,00 | 23,00 | 123,00",
      "Celkom uhradených záloh: | 61,50 EUR",
      "Celkom k úhrade vrátane DPH | 61,50 EUR",
    ],
    total: 6150,
    vatRecap: [row("23", 10000, 2300), row("23", -5000, -1150)],
    expect: {
      total: { cents: 12300, provenance: "extracted" },
      supply: [["23", 10000, 2300]],
      settlement: [["23", -5000, -1150]],
      advanceDeducted: 6150,
      amountDue: 6150,
      advanceDocumentNumbers: ["ZDD15000001"],
    },
  },
  {
    name: "several rates with one of them cancelled",
    lines: [
      "Zál. daň. dokl. základ 5% | -50,00 | DPH 5% | -2,50",
      "Základ 23% | 100,00 | DPH 23% | 23,00",
      "Základ 5% | 50,00 | DPH 5% | 2,50",
      "Celkom | 150,00 | 25,50 | 175,50",
      "Celkom uhradených záloh: | 52,50 EUR",
      "Odpočet zálohového daňového dokladu ZDD15000002",
    ],
    total: 0,
    vatRecap: [row("23", 10000, 2300), row("5", 5000, 250), row("5", -5000, -250)],
    expect: {
      total: { cents: 17550, provenance: "extracted" },
      supply: [
        ["23", 10000, 2300],
        ["5", 5000, 250],
      ],
      settlement: [["5", -5000, -250]],
      advanceDeducted: 5250,
      amountDue: 12300,
      advanceDocumentNumbers: ["ZDD15000002"],
    },
  },
  {
    name: "a printed gross total that disagrees with the supply rows gives the sum, derived",
    lines: [
      "Zál. daň. dokl. základ 23% | -40,00 | DPH 23% | -9,20",
      "Uhradené zálohou: 49,20",
      "Celkom k úhrade | 130,00",
    ],
    total: 13000,
    vatRecap: [row("23", 10000, 2300), row("23", -4000, -920)],
    expect: {
      total: { cents: 12300, provenance: "derived" },
      supply: [["23", 10000, 2300]],
      settlement: [["23", -4000, -920]],
      advanceDeducted: 4920,
      amountDue: 7380,
      advanceDocumentNumbers: [],
    },
  },
  {
    name: "a printed total within the legal cash rounding of base plus VAT is accepted",
    lines: [
      "Zál. daň. dokl. základ 23% | -5,00 | DPH 23% | -1,15",
      "Uhradené zálohou 6,15",
      "Celkom | 9,99 | 2,30 | 12,30",
    ],
    total: 1230,
    vatRecap: [row("23", 999, 230), row("23", -500, -115)],
    expect: {
      total: { cents: 1230, provenance: "extracted" },
      supply: [["23", 999, 230]],
      settlement: [["23", -500, -115]],
      advanceDeducted: 615,
      amountDue: 615,
      advanceDocumentNumbers: [],
    },
  },
  {
    name: "a zero total with non-zero supply rows is never accepted",
    lines: [
      "Zál. daň. dokl. základ 23% | -40,00 | DPH 23% | -9,20",
      "Uhradené zálohou: 49,20",
    ],
    total: 0,
    vatRecap: [row("23", 10000, 2300), row("23", -4000, -920)],
    expect: {
      total: { cents: 12300, provenance: "derived" },
      supply: [["23", 10000, 2300]],
      settlement: [["23", -4000, -920]],
      advanceDeducted: 4920,
      amountDue: 7380,
      advanceDocumentNumbers: [],
    },
  },
  {
    name: "Czech labels: záloha rows, uhrazeno zálohou, zálohový doklad",
    lines: [
      "Zálohový doklad č. 2026123456",
      "Záloha 21% | -100,00 | DPH 21% | -21,00",
      "Základ 21% | 100,00 | DPH 21% | 21,00",
      "Celkem | 100,00 | 21,00 | 121,00",
      "Uhrazeno zálohou: 121,00 CZK",
    ],
    total: 12100,
    vatRecap: [row("21", 10000, 2100), row("21", -10000, -2100)],
    currency: "CZK",
    expect: {
      total: { cents: 12100, provenance: "extracted" },
      supply: [["21", 10000, 2100]],
      settlement: [["21", -10000, -2100]],
      advanceDeducted: 12100,
      amountDue: 0,
      advanceDocumentNumbers: ["2026123456"],
    },
  },
  {
    name: "Slovak preddavok label with the advance total printed",
    lines: [
      "Faktúra za preddavok ZDD15555555",
      "Základ 23% | 100,00 | DPH 23% | 23,00",
      "Zál. daň. dokl. základ 23% | -100,00 | DPH 23% | -23,00",
      "Celkom uhradených záloh: | 123,00 EUR",
    ],
    total: 0,
    vatRecap: [row("23", 10000, 2300), row("23", -10000, -2300)],
    expect: {
      total: { cents: 12300, provenance: "extracted" },
      supply: [["23", 10000, 2300]],
      settlement: [["23", -10000, -2300]],
      advanceDeducted: 12300,
      amountDue: 0,
      advanceDocumentNumbers: ["ZDD15555555"],
    },
  },
  {
    name: "a credit note (negative supply, no deduction label) is not a settlement",
    lines: ["Dobropis č. 2026/9", "Základ 23% | -100,00 | DPH 23% | -23,00", "Celkom | -100,00 | -23,00 | -123,00"],
    total: -12300,
    vatRecap: [row("23", -10000, -2300)],
    expect: "not settled",
  },
  {
    name: "negative recap rows without a deduction label are not a settlement",
    lines: ["Základ 23% | 100,00 | DPH 23% | 23,00", "Opravný riadok 23% | -100,00 | DPH 23% | -23,00", "Celkom | 123,00"],
    total: 12300,
    vatRecap: [row("23", 10000, 2300), row("23", -10000, -2300)],
    expect: "not settled",
  },
  {
    name: "a zero total without a deduction label is not a settlement",
    lines: ["Základ 23% | 100,00 | DPH 23% | 23,00", "Celkom k úhrade | 0,00"],
    total: 0,
    vatRecap: [row("23", 10000, 2300)],
    expect: "not settled",
  },
  {
    name: "an advance invoice with only its own supply rows is not a settlement",
    lines: [
      "Zálohová faktúra č. ZF2026001",
      "Základ 21% | 100,00 | DPH 21% | 21,00",
      "Celkom | 100,00 | 21,00 | 121,00",
    ],
    total: 12100,
    vatRecap: [row("21", 10000, 2100)],
    currency: "CZK",
    expect: "not settled",
  },
  {
    name: "a deduction label with nothing deducted and no supply is not a settlement",
    lines: ["Zálohy celkom | 0,00", "Celkom k úhrade | 0,00"],
    total: 0,
    vatRecap: [],
    expect: "not settled",
  },
];

for (const testCase of CASES) {
  test(`advance settlement: ${testCase.name}`, () => {
    const result = settleAdvance({
      lines: testCase.lines,
      total: total(testCase.total),
      vatRecap: testCase.vatRecap,
      currency: testCase.currency,
    });
    if (testCase.expect === "not settled") {
      assert.deepEqual(result, { settled: false });
      return;
    }
    expectSettled(result, testCase.expect, testCase.name);
  });
}

test("a settlement never leaves a settlement row among the supply rows", () => {
  const result = settleAdvance({
    lines: ["Zál. daň. dokl. základ 0% | -43,89 | DPH 0% | 0,00", "Celkom k úhrade | 43,89"],
    total: total(0),
    vatRecap: [row("0", 4389, 0), row("0", -4389, 0)],
  });
  assert.equal(result.settled, true);
  if (result.settled) {
    assert.ok(result.supplyRows.every((r) => r.baseCents > 0));
    assert.equal(result.settlementRows.length, 1);
  }
});

test("all-zero recap rows are dropped from the supply rows of a settlement", () => {
  const result = settleAdvance({
    lines: ["Zál. daň. dokl. základ 23% | -32,51 | DPH 23% | -7,48", "Zálohy celkom | 39,99"],
    total: total(0),
    vatRecap: [row("0", 0, 0), row("5", 0, 0), row("23", 3251, 748), row("23", -3251, -748)],
  });
  assert.equal(result.settled, true);
  if (result.settled) {
    assert.deepEqual(result.supplyRows.map((r) => r.rateLiteral), ["23"]);
  }
});

test("a settled payload passes the arithmetic check, and a zero amount due is no mismatch", () => {
  const payload: ModelExtractedPayload = {
    kind: "extracted",
    source: "model",
    parties: [],
    documentNumber: "5022606206",
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 0,
    amountLiteral: "0.00",
    vatRecap: [row("23", 36465, 8387)],
    docTypeHint: "invoice",
  };
  const lines = [
    "Sadzba | Základ DPH | Čiastka DPH | Celkom s DPH",
    "23% | 364,65 | 83,87 | 448,52",
    "Celkom uhradených záloh: | 448,52 EUR",
    "Celkom k úhrade vrátane DPH | 0,00 | EUR",
  ];
  const settled = applyAdvanceSettlement(payload, lines);
  assert.equal(settled.amountCents, 44852);
  const checked = runExtractionChecks({
    payload: settled,
    sourceTextLines: lines,
    monthKey: "2026_05",
    issuerCountry: "SK",
  });
  assert.equal(checked.flags.amountCents, "correct");
  assert.equal(checked.flags.vatRecap, "correct");
});

test("applyAdvanceSettlement stores the settlement and keeps the supply as the recap", () => {
  const payload: ModelExtractedPayload = {
    kind: "extracted",
    source: "model",
    parties: [],
    documentNumber: null,
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 0,
    amountLiteral: "0.00",
    vatRecap: [row("0", 4389, 0), row("0", -4389, 0)],
    docTypeHint: "invoice",
  };
  const settled = applyAdvanceSettlement(payload, [
    "Odpočet zálohového daňového dokladu ZDD15873826",
    "Zál. daň. dokl. základ 0% | -43,89 | DPH 0% | 0,00",
    "Celkom k úhrade | 43,89",
  ]);
  assert.equal(settled.amountCents, 4389);
  assert.equal(settled.amountLiteral, "43.89");
  assert.deepEqual(settled.vatRecap.map((r) => r.baseCents), [4389]);
  assert.deepEqual(settled.advanceSettlement, {
    source: "detected",
    totalProvenance: "extracted",
    advanceDeductedCents: 4389,
    advanceDeductedLiteral: "43.89",
    amountDueCents: 0,
    amountDueLiteral: "0.00",
    advanceDocumentNumbers: ["ZDD15873826"],
    settlementRows: [
      { rateLiteral: "0", baseLiteral: "-43.89", baseCents: -4389, vatLiteral: "0.00", vatCents: 0 },
    ],
    originalAmountCents: 0,
    originalAmountLiteral: "0.00",
    originalVatRecap: [row("0", 4389, 0), row("0", -4389, 0)],
    identityWarning: null,
    findings: [],
  });
});

test("applyAdvanceSettlement returns an invoice that is not settled unchanged", () => {
  const payload: ModelExtractedPayload = {
    kind: "extracted",
    source: "model",
    parties: [],
    documentNumber: null,
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 12300,
    amountLiteral: "123.00",
    vatRecap: [row("23", 10000, 2300)],
    docTypeHint: "invoice",
  };
  assert.equal(applyAdvanceSettlement(payload, ["Základ 23% | 100,00 | DPH 23% | 23,00"]), payload);
});

// ---- Identity: total − advance = amount due (PRD 0004 issue 11) ----

const PLAIN_SUPPLY = [
  "Základ 23% | 364,65 | DPH 23% | 83,87",
  "Celkom | 364,65 | 83,87 | 448,52",
];

function identityOf(lines: string[], printedTotal: number | null, vatRecap: DocumentVatRecapRow[]) {
  const result = settleAdvance({ lines, total: total(printedTotal), vatRecap });
  assert.equal(result.settled, true);
  return result.settled ? result.identityWarning : "not settled";
}

test("identity: a printed amount due that matches total − advance gives no warning", () => {
  assert.equal(
    identityOf(
      [...PLAIN_SUPPLY, "Celkom uhradených záloh: | 448,52 EUR", "Celkom k úhrade vrátane DPH | 0,00 | EUR"],
      0,
      [row("23", 36465, 8387)],
    ),
    null,
  );
});

test("identity: a partial advance whose due matches gives no warning", () => {
  const lines = [...PLAIN_SUPPLY, "Uhradené zálohou: 200,00", "Celkom k úhrade | 248,52"];
  assert.equal(identityOf(lines, 24852, [row("23", 36465, 8387)]), null);
});

test("identity: a printed due within the legal cash rounding of total − advance is consistent", () => {
  // 448.52 − 200.00 = 248.52, which EUR cash rounding prints as 248.50.
  const lines = [...PLAIN_SUPPLY, "Uhradené zálohou: 200,00", "Celkom k úhrade | 248,50"];
  assert.equal(identityOf(lines, 24850, [row("23", 36465, 8387)]), null);
});

test("identity: a misread advance that breaks total − advance = due is flagged", () => {
  // The printed advance is 448.25, the due 0.00: 448.52 − 448.25 = 0.27 ≠ 0.00.
  const lines = [...PLAIN_SUPPLY, "Celkom uhradených záloh: | 448,25 EUR", "Celkom k úhrade vrátane DPH | 0,00 | EUR"];
  const warning = identityOf(lines, 0, [row("23", 36465, 8387)]);
  assert.match(warning ?? "", /^Odpočet zálohy nesedí: celkom − záloha ≠ k úhrade/);
});

test("identity: a partial advance with a printed due that does not follow is flagged", () => {
  const lines = [...PLAIN_SUPPLY, "Uhradené zálohou: 200,00", "Celkom k úhrade | 248,25"];
  assert.match(identityOf(lines, 24825, [row("23", 36465, 8387)]) ?? "", /^Odpočet zálohy nesedí/);
});

test("identity: an invoice whose total is the supply itself is not checked against a due", () => {
  // The model read the supply total as the total; there is no printed due to compare.
  const lines = [...PLAIN_SUPPLY, "Uhradené zálohou: 200,00"];
  assert.equal(identityOf(lines, 44852, [row("23", 36465, 8387)]), null);
});

test("identity: a warning is persisted in the payload and the rest of the findings stay apart", () => {
  const payload: ModelExtractedPayload = {
    kind: "extracted",
    source: "model",
    parties: [],
    documentNumber: null,
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 0,
    amountLiteral: "0.00",
    vatRecap: [row("23", 36465, 8387)],
    docTypeHint: "invoice",
  };
  const lines = [...PLAIN_SUPPLY, "Celkom uhradených záloh: | 448,25 EUR", "Celkom k úhrade vrátane DPH | 0,00 | EUR"];
  const settled = applyAdvanceSettlement(payload, lines);
  assert.match(settled.advanceSettlement?.identityWarning ?? "", /^Odpočet zálohy nesedí/);
  assert.ok(settled.advanceSettlement?.findings?.every((finding) => !finding.startsWith("Odpočet zálohy nesedí")));
});

// ---- Manual override, both directions (ADR 0010) ----

const SETTLED_PAYLOAD_LINES = [
  "Rekapitulácia DPH daňového dokladu 5022606206",
  "Sadzba | Základ DPH | Čiastka DPH | Celkom s DPH",
  "23% | 364,65 | 83,87 | 448,52",
  "Celkom | 364,65 | 83,87 | 448,52",
  "Celkom uhradených záloh: | 448,52 EUR",
  "Zálohové doklady č. : 5926010455 | 448,52 | EUR",
  "Celkom k úhrade vrátane DPH | 0,00 | EUR",
];

function plainInvoice(amountCents: number | null, vatRecap: DocumentVatRecapRow[]): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [],
    documentNumber: "5022606206",
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents,
    amountLiteral: amountCents === null ? null : (amountCents / 100).toFixed(2),
    vatRecap,
    docTypeHint: "invoice",
  };
}

test("override: not settled restores the plain extraction exactly as it was read", () => {
  const original = plainInvoice(0, [row("23", 36465, 8387)]);
  const detected = applyAdvanceSettlement(original, SETTLED_PAYLOAD_LINES);
  assert.equal(detected.advanceSettlement?.source, "detected");
  assert.deepStrictEqual(applyAdvanceOverride(detected, false), original);
});

test("override: settled on a detected invoice keeps the supply and marks the source as hers", () => {
  const detected = applyAdvanceSettlement(plainInvoice(0, [row("23", 36465, 8387)]), SETTLED_PAYLOAD_LINES);
  const overridden = applyAdvanceOverride(detected, true);
  assert.equal(overridden.amountCents, 44852);
  assert.equal(overridden.advanceSettlement?.source, "manual");
  assert.deepStrictEqual(
    { ...overridden.advanceSettlement, source: "detected" },
    detected.advanceSettlement,
  );
});

test("override: settled on an undetected invoice applies the settlement from its payload", () => {
  // No text is stored: the amount was read as 0.00 and the recap holds the full supply.
  const plain = plainInvoice(0, [row("23", 36465, 8387)]);
  const settled = applyAdvanceOverride(plain, true);
  assert.equal(settled.amountCents, 44852);
  assert.equal(settled.amountLiteral, "448.52");
  assert.deepEqual(settled.vatRecap.map((r) => [r.rateLiteral, r.baseCents, r.vatCents]), [["23", 36465, 8387]]);
  assert.equal(settled.advanceSettlement?.source, "manual");
  assert.equal(settled.advanceSettlement?.totalProvenance, "derived");
  assert.equal(settled.advanceSettlement?.advanceDeductedCents, 44852);
  assert.equal(settled.advanceSettlement?.amountDueCents, 0);
  assert.deepEqual(settled.advanceSettlement?.advanceDocumentNumbers, []);
  assert.equal(settled.advanceSettlement?.identityWarning, null);
  assert.deepEqual(settled.advanceSettlement?.originalVatRecap, [row("23", 36465, 8387)]);
  assert.equal(settled.advanceSettlement?.originalAmountCents, 0);
});

test("override: settled on an undetected invoice takes the deduction from its negative recap rows", () => {
  const plain = plainInvoice(0, [row("23", 10000, 2300), row("23", -4000, -920)]);
  const settled = applyAdvanceOverride(plain, true);
  assert.equal(settled.amountCents, 12300);
  assert.equal(settled.advanceSettlement?.advanceDeductedCents, 4920);
  assert.equal(settled.advanceSettlement?.amountDueCents, 7380);
  assert.deepEqual(settled.vatRecap.map((r) => r.baseCents), [10000]);
  assert.equal(settled.advanceSettlement?.settlementRows.length, 1);
});

test("override: settled is refused, with the payload unchanged, when no deduction can be read", () => {
  // The total already is the supply: nothing was deducted that the payload shows.
  const plain = plainInvoice(44852, [row("23", 36465, 8387)]);
  assert.equal(applyAdvanceOverride(plain, true), plain);
  // No supply rows at all.
  const empty = plainInvoice(0, []);
  assert.equal(applyAdvanceOverride(empty, true), empty);
});

test("override: no decision leaves the extraction as it is", () => {
  const plain = plainInvoice(12300, [row("23", 10000, 2300)]);
  assert.equal(applyAdvanceOverride(plain, undefined), plain);
});

test("override: a payload from before the originals were kept is restored from what it has", () => {
  const legacy = {
    ...applyAdvanceSettlement(plainInvoice(0, [row("23", 36465, 8387)]), SETTLED_PAYLOAD_LINES),
  };
  const block = { ...legacy.advanceSettlement! };
  delete block.originalAmountCents;
  delete block.originalAmountLiteral;
  delete block.originalVatRecap;
  const restored = applyAdvanceOverride({ ...legacy, advanceSettlement: block }, false);
  assert.equal(restored.advanceSettlement, undefined);
  assert.equal(restored.amountCents, 0);
  assert.deepEqual(restored.vatRecap.map((r) => r.baseCents), [36465]);
});

test("a partial advance's printed amount due is judged by the identity, not as a total mismatch", () => {
  const lines = [...PLAIN_SUPPLY, "Uhradené zálohou: 200,00", "Celkom k úhrade | 248,52"];
  const result = settleAdvance({ lines, total: total(24852), vatRecap: [row("23", 36465, 8387)] });
  assert.equal(result.settled, true);
  if (result.settled) {
    assert.deepEqual(result.findings, []);
    assert.equal(result.identityWarning, null);
  }
});
