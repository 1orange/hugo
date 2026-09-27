import { parseDecimalAmount } from "./money";

export type OmegaT01IssuedInvoice = {
  documentNumber: string;
  variableSymbol: string;
  customerName: string;
  customerIco: string;
  issueDateRaw: string;
  dueDateRaw: string;
  taxableSupplyDateRaw: string;
  currency: string;
  amountCents: number | null;
  amountLiteral: string | null;
  vatRecap: Array<{
    rateLiteral: string;
    baseLiteral: string;
    baseCents: number;
    vatLiteral: string;
    vatCents: number;
  }>;
};

const R01 = "R01";

function parseT01Amount(raw: string): { literal: string; cents: number } | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === "0" || trimmed === "0.0000") {
    return null;
  }
  const normalized = trimmed.replace(/\s/g, "").replace(",", ".");
  const parsed = parseDecimalAmount(normalized);
  if (!("cents" in parsed)) {
    return null;
  }
  return { literal: parsed.literal, cents: parsed.cents };
}

function readVatSlots(cols: string[]): OmegaT01IssuedInvoice["vatRecap"] {
  const slots: Array<{ baseIdx: number; vatIdx: number; rateLiteral: string }> = [
    { baseIdx: 7, vatIdx: 13, rateLiteral: "19" },
    { baseIdx: 8, vatIdx: 14, rateLiteral: "23" },
    { baseIdx: 9, vatIdx: 15, rateLiteral: "5" },
  ];
  const recap: OmegaT01IssuedInvoice["vatRecap"] = [];
  for (const slot of slots) {
    const base = parseT01Amount(cols[slot.baseIdx] ?? "");
    const vat = parseT01Amount(cols[slot.vatIdx] ?? "");
    if (!base) {
      continue;
    }
    recap.push({
      rateLiteral: slot.rateLiteral,
      baseLiteral: base.literal,
      baseCents: base.cents,
      vatLiteral: vat?.literal ?? "0",
      vatCents: vat?.cents ?? 0,
    });
  }
  return recap;
}

export function parseOmegaT01IssuedInvoices(exportText: string): OmegaT01IssuedInvoice[] {
  const invoices: OmegaT01IssuedInvoice[] = [];
  for (const line of exportText.split(/\r?\n/)) {
    if (!line.startsWith(`${R01}\t`)) {
      continue;
    }
    const cols = line.split("\t");
    const documentNumber = (cols[1] ?? "").trim();
    if (documentNumber.length === 0) {
      continue;
    }
    const vatRecap = readVatSlots(cols);
    const total = parseT01Amount(cols[16] ?? "");
    const variableSymbol = (cols[70] ?? documentNumber).trim() || documentNumber;
    invoices.push({
      documentNumber,
      variableSymbol,
      customerName: (cols[2] ?? "").trim(),
      customerIco: (cols[3] ?? "").replace(/\s/g, ""),
      issueDateRaw: (cols[4] ?? "").trim(),
      dueDateRaw: (cols[5] ?? "").trim(),
      taxableSupplyDateRaw: (cols[6] ?? "").trim(),
      currency: (cols[39] ?? "EUR").trim() || "EUR",
      amountCents: total?.cents ?? null,
      amountLiteral: total?.literal ?? null,
      vatRecap,
    });
  }
  return invoices;
}

export function skCalendarRawToIso(raw: string): string | null {
  const compact = raw.replace(/\s/g, "");
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(compact);
  if (!match) {
    return null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}
