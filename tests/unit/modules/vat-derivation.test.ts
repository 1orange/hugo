import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveVat, type VatMoney } from "../../../src/modules/vat-derivation.ts";
import type { DocumentVatRecapRow } from "../../../src/modules/document-payload.ts";

function money(cents: number | null, provenance: VatMoney["provenance"] = "extracted"): VatMoney {
  return { cents, literal: cents === null ? "" : (cents / 100).toFixed(2), provenance };
}

function row(rate: string, baseCents: number, vatCents: number): DocumentVatRecapRow {
  return {
    rateLiteral: rate,
    baseLiteral: (baseCents / 100).toFixed(2),
    baseCents,
    vatLiteral: (vatCents / 100).toFixed(2),
    vatCents,
  };
}

function input(overrides: Partial<Parameters<typeof deriveVat>[0]> = {}) {
  return {
    amount: money(null),
    recapBase: money(null, "empty"),
    recapVat: money(null, "empty"),
    vatRecap: [],
    vatRecapProvenance: "empty" as const,
    folderSlot: "02 Prijaté faktúry",
    supplierIcDph: "SK1234567890",
    profileCountry: "SK" as const,
    ...overrides,
  };
}

test("fills missing aggregate totals from every valid VAT row, including zero rate", () => {
  const result = deriveVat(input({
    vatRecap: [row("23", 10000, 2300), row("0", 5000, 0), row("5", 2000, 100)],
  }));
  assert.equal(result.recapBase.cents, 17000);
  assert.equal(result.recapBase.literal, "170.00");
  assert.equal(result.recapVat.cents, 2400);
  assert.equal(result.recapVat.literal, "24.00");
  assert.equal(result.recapBase.provenance, "derived");
  assert.equal(result.recapVat.provenance, "derived");
});

test("preserves populated aggregate values independently", () => {
  const result = deriveVat(input({
    recapBase: money(9999, "confirmed"),
    vatRecap: [row("23", 10000, 2300)],
  }));
  assert.equal(result.recapBase.cents, 9999);
  assert.equal(result.recapBase.provenance, "confirmed");
  assert.equal(result.recapVat.cents, 2300);
  assert.equal(result.recapVat.provenance, "derived");
});

test("supports signed credit-note rows and rejects incomplete rows", () => {
  const result = deriveVat(input({
    vatRecap: [row("23", -10000, -2300)],
  }));
  assert.equal(result.recapBase.cents, -10000);
  assert.equal(result.recapVat.cents, -2300);

  const invalid = deriveVat(input({
    vatRecap: [{ ...row("23", 10000, 2300), baseLiteral: "" }],
  }));
  assert.equal(invalid.recapBase.cents, null);
  assert.match(invalid.warnings[0]!, /neúplný/);
});

test("infers every Slovak permitted single rate and prefers supplier country", () => {
  for (const [rate, base] of [[23, 10000], [19, 10000], [5, 10000], [0, 10000]] as const) {
    const result = deriveVat(input({
      amount: money(base + Math.round((base * rate) / 100)),
      recapBase: money(base),
      recapVat: money(null, "empty"),
    }));
    assert.equal(result.vatRecap[0]?.rateLiteral, String(rate));
  }
  const czech = deriveVat(input({
    amount: money(12100),
    recapBase: money(10000),
    supplierIcDph: "CZ12345678",
  }));
  assert.equal(czech.vatRecap[0]?.rateLiteral, "21");
  assert.equal(czech.issuerCountry, "CZ");
});

test("uses profile fallback with warning and abstains on unsafe arithmetic", () => {
  const fallback = deriveVat(input({
    amount: money(12300),
    recapBase: money(10000),
    supplierIcDph: null,
  }));
  assert.equal(fallback.vatRecap[0]?.rateLiteral, "23");
  assert.equal(fallback.issuerCountryFallback, true);
  assert.ok(fallback.warnings.some((warning) => /profilu/.test(warning)));

  const zeroBase = deriveVat(input({ amount: money(100), recapBase: money(0) }));
  assert.equal(zeroBase.vatRecap.length, 0);
  assert.ok(zeroBase.warnings.length > 0);

  const ambiguous = deriveVat(input({ amount: money(0), recapBase: money(0) }));
  assert.equal(ambiguous.vatRecap.length, 0);
});

test("one-cent tolerance is accepted, but ambiguity and unsupported countries are not", () => {
  const tolerance = deriveVat(input({ amount: money(12301), recapBase: money(10000) }));
  assert.equal(tolerance.vatRecap[0]?.rateLiteral, "23");
  const tooFar = deriveVat(input({ amount: money(12302), recapBase: money(10000) }));
  assert.equal(tooFar.vatRecap.length, 0);
  const unsupported = deriveVat(input({
    amount: money(12300),
    recapBase: money(10000),
    supplierIcDph: "DE123456789",
    profileCountry: null,
  }));
  assert.equal(unsupported.vatRecap.length, 0);
});

test("manual VAT row protects the value from recalculation", () => {
  const result = deriveVat(input({
    amount: money(12300),
    recapBase: money(10000),
    recapVat: money(9999, "confirmed"),
    vatRecap: [row("manual", 10000, 9999)],
    vatRecapProvenance: "confirmed",
  }));
  assert.equal(result.recapVat.cents, 9999);
  assert.equal(result.vatRecap[0]?.vatCents, 9999);
});

test("recalculates stale derived aggregates from current VAT rows", () => {
  const result = deriveVat({
    amount: { literal: "110.00", cents: 11000, provenance: "extracted" },
    recapBase: { literal: "100.00", cents: 10000, provenance: "derived" },
    recapVat: { literal: "23.00", cents: 2300, provenance: "derived" },
    vatRecap: [
      {
        rateLiteral: "10",
        baseLiteral: "90.00",
        baseCents: 9000,
        vatLiteral: "9.00",
        vatCents: 900,
      },
    ],
    vatRecapProvenance: "extracted",
    folderSlot: "02 Prijaté faktúry",
    supplierIcDph: "SK1234567890",
  });
  assert.equal(result.recapBase.literal, "90.00");
  assert.equal(result.recapVat.literal, "9.00");
});

test("recalculates a prior derived VAT rate when its recap VAT is stale", () => {
  const result = deriveVat({
    amount: { literal: "123.00", cents: 12300, provenance: "extracted" },
    recapBase: { literal: "100.00", cents: 10000, provenance: "extracted" },
    recapVat: { literal: "99.00", cents: 9900, provenance: "derived" },
    vatRecap: [],
    vatRecapProvenance: "derived",
    folderSlot: "02 Prijaté faktúry",
    supplierIcDph: "SK1234567890",
  });
  assert.deepEqual(result.vatRecap.map((row) => row.rateLiteral), ["23"]);
  assert.equal(result.recapVat.literal, "23.00");
});
