import { parseDecimalAmount } from "./money";

export type ParsedVatRegisterRow = {
  evidenceCode: string;
  internalNumber: string;
  supplierDocumentNumber: string;
  taxableSupplyDateRaw: string;
  appliedDateRaw: string;
  supplierIcDph: string;
  partnerShortName: string;
  kvDphSection: string;
  vatRecap: Array<{
    rateLiteral: string;
    baseLiteral: string;
    baseCents: number;
    vatLiteral: string;
    vatCents: number;
  }>;
};

const ROW_PREFIX = /^(DF|IDk|zDF|FDD(?:\s+[^|]+)?)\s*\|/;

function parseRegisterAmount(raw: string): { literal: string; cents: number } | null {
  const trimmed = raw.trim().replace(/\s/g, "");
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = parseDecimalAmount(trimmed.replace(",", "."));
  if (!("cents" in parsed)) {
    return null;
  }
  return { literal: parsed.literal, cents: parsed.cents };
}

function normalizeRegisterDate(raw: string): string {
  return raw.replace(/\s/g, "");
}

function isIcDphCell(cell: string): boolean {
  const compact = cell.replace(/\s/g, "").toUpperCase();
  return /^(SK|CZ|NL)[0-9A-Z]+$/.test(compact);
}

/**
 * The register prints a reduced-rate and a standard-rate column, but text
 * extraction drops empty cells, so a lone base/VAT pair does not say which
 * column it came from. The section heading above the rows does.
 */
export function sectionRateFromHeading(line: string): string | null {
  if (/znížená sadzba DPH 2/.test(line)) {
    return "5";
  }
  if (/znížená sadzba DPH/.test(line)) {
    return "19";
  }
  if (/základná sadzba DPH/.test(line)) {
    return "23";
  }
  return null;
}

const STANDARD_RATE = "23";

function readRecapTail(parts: string[], sectionRate: string): {
  kvDphSection: string;
  vatRecap: ParsedVatRegisterRow["vatRecap"];
} | null {
  if (parts.length < 4) {
    return null;
  }
  const kvDphSection = (parts[parts.length - 3] ?? "").trim().toUpperCase();
  if (!/^B[0-9]+$/.test(kvDphSection)) {
    return null;
  }
  const standardVat = parseRegisterAmount(parts[parts.length - 1] ?? "");
  const standardBase = parseRegisterAmount(parts[parts.length - 2] ?? "");
  if (!standardVat || !standardBase) {
    return null;
  }
  const vatRecap: ParsedVatRegisterRow["vatRecap"] = [
    {
      rateLiteral: sectionRate,
      baseLiteral: standardBase.literal,
      baseCents: standardBase.cents,
      vatLiteral: standardVat.literal,
      vatCents: standardVat.cents,
    },
  ];
  const reducedVat = parseRegisterAmount(parts[parts.length - 4] ?? "");
  const reducedBase = parseRegisterAmount(parts[parts.length - 5] ?? "");
  if (reducedVat && reducedBase) {
    // Both columns filled: the last pair is the standard rate after all.
    vatRecap[0]!.rateLiteral = STANDARD_RATE;
    vatRecap.unshift({
      rateLiteral: "5",
      baseLiteral: reducedBase.literal,
      baseCents: reducedBase.cents,
      vatLiteral: reducedVat.literal,
      vatCents: reducedVat.cents,
    });
  }
  return { kvDphSection, vatRecap };
}

export function parseVatRegisterDeductionRow(
  line: string,
  sectionRate: string = STANDARD_RATE,
): ParsedVatRegisterRow | null {
  const trimmed = line.trim();
  if (!ROW_PREFIX.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split(" | ").map((part) => part.trim());
  const tail = readRecapTail(parts, sectionRate);
  if (!tail) {
    return null;
  }

  const headParts = parts.slice(0, parts.length - (tail.vatRecap.length === 2 ? 5 : 3));
  const first = headParts[0] ?? "";

  if (first.startsWith("FDD ")) {
    const internalNumber = first.slice(4).trim();
    const icDphIndex = headParts.findIndex((cell) => isIcDphCell(cell));
    if (icDphIndex < 2) {
      return null;
    }
    return {
      evidenceCode: "FDD",
      internalNumber,
      supplierDocumentNumber: (headParts[1] ?? "").trim(),
      taxableSupplyDateRaw: normalizeRegisterDate(headParts[icDphIndex - 2] ?? ""),
      appliedDateRaw: normalizeRegisterDate(headParts[icDphIndex - 1] ?? ""),
      supplierIcDph: (headParts[icDphIndex] ?? "").replace(/\s/g, " ").trim(),
      partnerShortName: (headParts[icDphIndex + 1] ?? "").trim(),
      kvDphSection: tail.kvDphSection,
      vatRecap: tail.vatRecap,
    };
  }

  const evidenceCode = first;
  if (!["DF", "IDk", "zDF"].includes(evidenceCode)) {
    return null;
  }

  const internalNumber = (headParts[1] ?? "").trim();
  if (internalNumber.length === 0) {
    return null;
  }

  const icDphIndex = headParts.findIndex((cell) => isIcDphCell(cell));
  if (icDphIndex < 2) {
    return null;
  }

  const supplierDocumentNumber =
    evidenceCode === "IDk" ? internalNumber : (headParts[2] ?? "").trim();

  return {
    evidenceCode,
    internalNumber,
    supplierDocumentNumber,
    taxableSupplyDateRaw: normalizeRegisterDate(headParts[icDphIndex - 2] ?? ""),
    appliedDateRaw: normalizeRegisterDate(headParts[icDphIndex - 1] ?? ""),
    supplierIcDph: (headParts[icDphIndex] ?? "").replace(/\s/g, " ").trim(),
    partnerShortName: (headParts[icDphIndex + 1] ?? "").trim(),
    kvDphSection: tail.kvDphSection,
    vatRecap: tail.vatRecap,
  };
}

export function parseVatRegisterDeductionLines(lines: string[]): ParsedVatRegisterRow[] {
  const rows: ParsedVatRegisterRow[] = [];
  let pendingHead: string | null = null;
  let sectionRate = STANDARD_RATE;
  for (const line of lines) {
    const trimmed = line.trim();
    const headingRate = sectionRateFromHeading(trimmed);
    if (headingRate) {
      sectionRate = headingRate;
      continue;
    }
    if (/^FDD\s+\S+$/.test(trimmed) && !trimmed.includes("|")) {
      pendingHead = trimmed;
      continue;
    }
    const candidate = pendingHead ? `${pendingHead} | ${trimmed}` : trimmed;
    pendingHead = null;
    const parsed = parseVatRegisterDeductionRow(candidate, sectionRate);
    if (parsed) {
      rows.push(parsed);
    }
  }
  return rows;
}

export function registerRowMatchKeys(row: ParsedVatRegisterRow): string[] {
  const keys = new Set<string>();
  keys.add(row.internalNumber);
  keys.add(row.supplierDocumentNumber);
  return [...keys].filter((key) => key.length > 0);
}

export function mergeRegisterRows(rows: ParsedVatRegisterRow[]): ParsedVatRegisterRow[] {
  const byInternal = new Map<string, ParsedVatRegisterRow>();
  for (const row of rows) {
    const key = `${row.evidenceCode}:${row.internalNumber}`;
    const existing = byInternal.get(key);
    if (!existing) {
      byInternal.set(key, { ...row, vatRecap: [...row.vatRecap] });
      continue;
    }
    existing.vatRecap.push(...row.vatRecap);
  }
  return [...byInternal.values()];
}
