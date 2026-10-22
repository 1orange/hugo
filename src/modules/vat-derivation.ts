import type { CompanyCountry } from "./company-profile";
import type { DocumentVatRecapRow } from "./document-payload";

export type VatProvenance = "confirmed" | "extracted" | "profile" | "derived" | "empty";

export type VatMoney = {
  literal: string;
  cents: number | null;
  provenance: VatProvenance;
};

export type VatDerivationResult = {
  recapBase: VatMoney;
  recapVat: VatMoney;
  vatRecap: DocumentVatRecapRow[];
  vatRecapProvenance: VatProvenance;
  warnings: string[];
  issuerCountry: CompanyCountry | null;
  issuerCountryFallback: boolean;
};

const SK_RATES = [23, 19, 5, 0] as const;
const CZ_RATES = [21, 12, 0] as const;

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function normalizeVatId(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

export function countryFromVatId(value: string | null | undefined): CompanyCountry | null {
  const normalized = normalizeVatId(value);
  if (/^SK\d{10}$/.test(normalized)) return "SK";
  if (/^CZ\d{8,10}$/.test(normalized)) return "CZ";
  return null;
}

function parseAmount(literal: string, cents: number): boolean {
  const trimmed = literal.trim();
  if (!trimmed) return false;
  const normalized = trimmed.replace(/\s+/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return false;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Math.round(parsed * 100) === cents;
}

function validRow(row: DocumentVatRecapRow): boolean {
  return (
    row.rateLiteral.trim().length > 0 &&
    /^-?\d+(?:[.,]\d+)?%?$/.test(row.rateLiteral.trim()) &&
    parseAmount(row.baseLiteral, row.baseCents) &&
    parseAmount(row.vatLiteral, row.vatCents)
  );
}

function hasValue(value: VatMoney): boolean {
  return value.cents !== null && value.literal.trim().length > 0;
}

function missingValue(value: VatMoney): boolean {
  return !hasValue(value);
}

function emptyOr(value: VatMoney, cents: number): VatMoney {
  return missingValue(value)
    ? { literal: formatCents(cents), cents, provenance: "derived" }
    : value;
}

function inferredCountry(input: {
  folderSlot: string;
  supplierIcDph?: string | null;
  profileCountry?: CompanyCountry | null;
}): { country: CompanyCountry | null; fallback: boolean } {
  if (input.folderSlot.startsWith("01 ")) {
    return { country: input.profileCountry ?? null, fallback: false };
  }
  if (input.folderSlot.startsWith("02 ")) {
    const supplierCountry = countryFromVatId(input.supplierIcDph);
    if (supplierCountry) return { country: supplierCountry, fallback: false };
    return { country: input.profileCountry ?? null, fallback: input.profileCountry != null };
  }
  return { country: null, fallback: false };
}

/**
 * Fill safe aggregate VAT values and infer one VAT row from total/base. All
 * arithmetic is integer minor-unit arithmetic; populated values are never
 * replaced. The function is pure so the editor, server projection, and
 * Omega export can consume the same effective result.
 */
export function deriveVat(input: {
  amount: VatMoney;
  recapBase: VatMoney;
  recapVat: VatMoney;
  vatRecap: DocumentVatRecapRow[];
  vatRecapProvenance: VatProvenance;
  folderSlot: string;
  supplierIcDph?: string | null;
  profileCountry?: CompanyCountry | null;
  enabled?: boolean;
}): VatDerivationResult {
  let recapBase = input.recapBase;
  let recapVat = input.recapVat;
  let vatRecap = [...input.vatRecap];
  let vatRecapProvenance = input.vatRecapProvenance;
  const warnings: string[] = [];
  const enabled = input.enabled !== false;
  const nonEmptyRows = input.vatRecap.filter(
    (row) => row.rateLiteral.trim() || row.baseLiteral.trim() || row.vatLiteral.trim(),
  );
  const validRows = nonEmptyRows.filter(validRow);
  const hasInvalidRows = nonEmptyRows.length > validRows.length;

  if (hasInvalidRows) {
    warnings.push("Niektorý riadok DPH je neúplný alebo má neplatnú sumu.");
  }

  if (enabled && validRows.length > 0 && !hasInvalidRows) {
    const baseSum = validRows.reduce((sum, row) => sum + row.baseCents, 0);
    const vatSum = validRows.reduce((sum, row) => sum + row.vatCents, 0);
    recapBase =
      recapBase.provenance === "derived"
        ? { literal: formatCents(baseSum), cents: baseSum, provenance: "derived" }
        : emptyOr(recapBase, baseSum);
    recapVat =
      recapVat.provenance === "derived"
        ? { literal: formatCents(vatSum), cents: vatSum, provenance: "derived" }
        : emptyOr(recapVat, vatSum);
  }

  const { country: issuerCountry, fallback: issuerCountryFallback } = inferredCountry(input);
  const canInferSingleRate =
    enabled &&
    nonEmptyRows.length === 0 &&
    input.amount.cents !== null &&
    input.recapBase.cents !== null &&
    (!hasValue(input.recapVat) || input.recapVat.provenance === "derived") &&
    hasValue(input.amount);

  if (canInferSingleRate) {
    const amountCents = input.amount.cents!;
    const baseCents = input.recapBase.cents!;
    if (!issuerCountry) {
      warnings.push("Sadzbu DPH nemožno dopočítať bez krajiny vystaviteľa.");
    } else if (baseCents === 0 && amountCents !== 0) {
      warnings.push("Sadzbu DPH nemožno dopočítať pri nulovom základe a nenulovej sume.");
    } else {
      const vatCents = amountCents - baseCents;
      const candidates = (issuerCountry === "CZ" ? CZ_RATES : SK_RATES).filter(
        (rate) => Math.abs(Math.round((baseCents * rate) / 100) - vatCents) <= 1,
      );
      if (candidates.length !== 1) {
        warnings.push(
          candidates.length === 0
            ? "Sadzba DPH nezodpovedá povolenej sadzbe krajiny vystaviteľa."
            : "Sadzba DPH nie je jednoznačná.",
        );
      } else if (
        input.recapVat.cents === null ||
        input.recapVat.cents === undefined ||
        input.recapVat.provenance === "derived"
      ) {
        const rate = candidates[0]!;
        vatRecap = [
          {
            rateLiteral: String(rate),
            baseLiteral: input.recapBase.literal,
            baseCents,
            vatLiteral: formatCents(vatCents),
            vatCents,
          },
        ];
        vatRecapProvenance = "derived";
        recapVat = { literal: formatCents(vatCents), cents: vatCents, provenance: "derived" };
      }
    }
    if (issuerCountryFallback) {
      warnings.push("Krajina vystaviteľa bola určená z profilu firmy — skontroluj ju.");
    }
  }

  return {
    recapBase,
    recapVat,
    vatRecap,
    vatRecapProvenance,
    warnings,
    issuerCountry,
    issuerCountryFallback,
  };
}
