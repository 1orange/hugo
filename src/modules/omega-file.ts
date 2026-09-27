import iconv from "iconv-lite";
import type { DocumentVatRecapRow } from "./document-payload";
import { formatEuroFromCents } from "./money";

export type OmegaExportSettings = {
  t01EvidenceCode: string;
  t01SeriesCode: string;
  t01ReceivedEvidenceCode: string;
  t01ReceivedSeriesCode: string;
  t00EvidenceCode: string;
  t00SeriesCode: string;
  t00DocumentTypeCode: number;
  t00ForeignDocumentTypeCode: number;
};

export type OmegaPartnerRecord = {
  partnerKey: string;
  country: string;
  name: string;
  street: string;
  psc: string;
  city: string;
  ico: string;
  dic: string;
  icDph: string;
};

export type OmegaInvoiceDraft = {
  driveFileId: string;
  exportNumber: string;
  docType: 0 | 14;
  variableSymbol: string;
  issueDate: string;
  dueDate: string;
  taxableSupplyDate: string;
  currency: string;
  counterparty: OmegaPartnerRecord;
  vatRecap: DocumentVatRecapRow[];
  totalCents: number;
};

export type OmegaReceiptDraft = {
  driveFileId: string;
  exportNumber: string;
  docTypeCode: number;
  evidenceCode: string;
  seriesCode: string;
  externalNumber: string;
  issueDate: string;
  receiptDate: string;
  dueDate: string;
  taxableSupplyDate: string;
  transactionDate: string;
  currency: string;
  foreignCurrency: boolean;
  counterparty: OmegaPartnerRecord;
  vatRecap: DocumentVatRecapRow[];
  totalCents: number;
};

export type OmegaExportInput = {
  monthKey: string;
  settings: OmegaExportSettings;
  invoices: OmegaInvoiceDraft[];
  receipts: OmegaReceiptDraft[];
  partners: OmegaPartnerRecord[];
};

export type OmegaExportPlan = {
  includedInvoices: OmegaInvoiceDraft[];
  includedReceipts: OmegaReceiptDraft[];
  heldBack: Array<{ driveFileId: string; reason: string }>;
};

const LIMIT = {
  exportNumber: 20,
  partnerName: 75,
  ico: 12,
  variableSymbol: 20,
  street: 40,
  psc: 6,
  city: 40,
  dic: 50,
  icDph: 50,
  itemName: 200,
  evidenceCode: 5,
  seriesCode: 5,
} as const;

const T01_R01_COLUMNS = 97;
const T00_R01_COLUMNS = 71;
const T04_R01_COLUMNS = 28;
const T01_R02_COLUMNS = 58;
const T00_R02_COLUMNS = 35;

function truncateFreeText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return trimmed.slice(0, max);
}

function fitsIdentifier(value: string, max: number): boolean {
  return value.trim().length > 0 && value.trim().length <= max;
}

function parseRateLiteral(rateLiteral: string): number | null {
  const normalized = rateLiteral.trim().replace(",", ".");
  if (normalized.length === 0) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

type VatSlotTotals = {
  lowerBaseCents: number;
  higherBaseCents: number;
  zeroBaseCents: number;
  exemptBaseCents: number;
  lowerVatCents: number;
  higherVatCents: number;
  lowerRate: number;
  higherRate: number;
  rowsBySlot: Array<{
    slot: "lower" | "higher" | "zero" | "exempt";
    recap: DocumentVatRecapRow;
  }>;
};

function assignVatSlots(recap: readonly DocumentVatRecapRow[]): VatSlotTotals {
  const totals: VatSlotTotals = {
    lowerBaseCents: 0,
    higherBaseCents: 0,
    zeroBaseCents: 0,
    exemptBaseCents: 0,
    lowerVatCents: 0,
    higherVatCents: 0,
    lowerRate: 19,
    higherRate: 23,
    rowsBySlot: [],
  };

  for (const row of recap) {
    const rate = parseRateLiteral(row.rateLiteral);
    if (rate === 23) {
      totals.higherBaseCents += row.baseCents;
      totals.higherVatCents += row.vatCents;
      totals.rowsBySlot.push({ slot: "higher", recap: row });
      continue;
    }
    if (rate === 19 || rate === 5) {
      totals.lowerBaseCents += row.baseCents;
      totals.lowerVatCents += row.vatCents;
      totals.lowerRate = rate;
      totals.rowsBySlot.push({ slot: "lower", recap: row });
      continue;
    }
    if (rate === 0) {
      totals.zeroBaseCents += row.baseCents;
      totals.rowsBySlot.push({ slot: "zero", recap: row });
      continue;
    }
    totals.exemptBaseCents += row.baseCents;
    totals.rowsBySlot.push({ slot: "exempt", recap: row });
  }

  return totals;
}

function dotAmountFromCents(cents: number): string {
  if (cents % 100 === 0) {
    return String(cents / 100);
  }
  return formatEuroFromCents(cents);
}

function dotAmountFromLiteral(literal: string, cents: number): string {
  if (literal.trim().length > 0) {
    return literal.trim().replace(",", ".");
  }
  return dotAmountFromCents(cents);
}

function validateReceipt(receipt: OmegaReceiptDraft): string | null {
  if (!fitsIdentifier(receipt.exportNumber, LIMIT.exportNumber)) {
    return "Exportné číslo je príliš dlhé.";
  }
  if (!fitsIdentifier(receipt.externalNumber, LIMIT.variableSymbol)) {
    return "Externé číslo sa nezmestí do Omega (max 20 znakov).";
  }
  if (!fitsIdentifier(receipt.counterparty.ico, LIMIT.ico)) {
    return "IČO partnera sa nezmestí do Omega (max 12 znakov).";
  }
  if (receipt.issueDate.trim().length === 0) {
    return "Chýba dátum vystavenia.";
  }
  if (receipt.vatRecap.length === 0) {
    return "Chýba rekapitulácia DPH.";
  }
  return null;
}

function validateInvoice(invoice: OmegaInvoiceDraft): string | null {
  if (!fitsIdentifier(invoice.exportNumber, LIMIT.exportNumber)) {
    return "Exportné číslo je príliš dlhé.";
  }
  if (!fitsIdentifier(invoice.variableSymbol, LIMIT.variableSymbol)) {
    return "VS sa nezmestí do Omega (max 20 znakov).";
  }
  if (!fitsIdentifier(invoice.counterparty.ico, LIMIT.ico)) {
    return "IČO partnera sa nezmestí do Omega (max 12 znakov).";
  }
  if (invoice.issueDate.trim().length === 0) {
    return "Chýba dátum vystavenia.";
  }
  if (invoice.vatRecap.length === 0) {
    return "Chýba rekapitulácia DPH.";
  }
  return null;
}

export function planOmegaExport(input: OmegaExportInput): OmegaExportPlan {
  const includedInvoices: OmegaInvoiceDraft[] = [];
  const includedReceipts: OmegaReceiptDraft[] = [];
  const heldBack: Array<{ driveFileId: string; reason: string }> = [];

  for (const invoice of input.invoices) {
    const reason = validateInvoice(invoice);
    if (reason) {
      heldBack.push({ driveFileId: invoice.driveFileId, reason });
      continue;
    }
    includedInvoices.push(invoice);
  }

  for (const receipt of input.receipts) {
    const reason = validateReceipt(receipt);
    if (reason) {
      heldBack.push({ driveFileId: receipt.driveFileId, reason });
      continue;
    }
    includedReceipts.push(receipt);
  }

  return { includedInvoices, includedReceipts, heldBack };
}

function emptyRow(length: number): string[] {
  return Array.from({ length }, () => "");
}

function renderT04Partner(partner: OmegaPartnerRecord): string {
  const cols = emptyRow(T04_R01_COLUMNS);
  cols[0] = "R01";
  cols[1] = truncateFreeText(partner.name, LIMIT.partnerName);
  cols[2] = partner.ico.trim();
  cols[3] = truncateFreeText(partner.street, LIMIT.street);
  cols[4] = truncateFreeText(partner.psc, LIMIT.psc);
  cols[5] = truncateFreeText(partner.city, LIMIT.city);
  cols[7] = partner.country.trim() || "SLOVENSKÁ REPUBLIKA";
  const vat = partner.icDph.trim().toUpperCase();
  cols[24] = vat.startsWith("SK") ? "SK" : partner.country.trim();
  cols[25] = truncateFreeText(vat, LIMIT.icDph);
  cols[26] = truncateFreeText(partner.dic.trim(), LIMIT.dic);
  return cols.join("\t");
}

function renderT01Header(
  invoice: OmegaInvoiceDraft,
  settings: OmegaExportSettings,
  slots: VatSlotTotals,
): string {
  const cols = emptyRow(T01_R01_COLUMNS);
  cols[0] = "R01";
  cols[1] = invoice.exportNumber.trim();
  cols[2] = truncateFreeText(invoice.counterparty.name, LIMIT.partnerName);
  cols[3] = invoice.counterparty.ico.trim();
  cols[4] = invoice.issueDate.trim();
  cols[5] = invoice.dueDate.trim();
  cols[6] = invoice.taxableSupplyDate.trim();
  cols[7] = dotAmountFromCents(slots.lowerBaseCents);
  cols[8] = dotAmountFromCents(slots.higherBaseCents);
  cols[9] = dotAmountFromCents(slots.zeroBaseCents);
  cols[10] = dotAmountFromCents(slots.exemptBaseCents);
  cols[11] = String(slots.lowerRate);
  cols[12] = String(slots.higherRate);
  cols[13] = dotAmountFromCents(slots.lowerVatCents);
  cols[14] = dotAmountFromCents(slots.higherVatCents);
  cols[15] = "0";
  cols[16] = dotAmountFromCents(invoice.totalCents);
  cols[17] = String(invoice.docType);
  const evidence =
    invoice.docType === 14
      ? settings.t01ReceivedEvidenceCode
      : settings.t01EvidenceCode;
  const series =
    invoice.docType === 14
      ? settings.t01ReceivedSeriesCode
      : settings.t01SeriesCode;
  cols[18] = truncateFreeText(evidence, LIMIT.evidenceCode);
  cols[19] = truncateFreeText(series, LIMIT.seriesCode);
  cols[39] = invoice.currency.trim() || "EUR";
  cols[40] = "1";
  cols[41] = "1";
  cols[42] = dotAmountFromCents(invoice.totalCents);
  cols[70] = invoice.variableSymbol.trim();
  return cols.join("\t");
}

function renderT01Item(slot: VatSlotTotals["rowsBySlot"][number]): string {
  const cols = emptyRow(T01_R02_COLUMNS);
  const rateLabel = slot.recap.rateLiteral.trim() || "?";
  cols[0] = "R02";
  cols[1] = truncateFreeText(`Polozka DPH ${rateLabel}%`, LIMIT.itemName);
  cols[2] = "1";
  cols[3] = "ks";
  cols[4] = dotAmountFromLiteral(slot.recap.baseLiteral, slot.recap.baseCents);
  cols[5] = "V";
  cols[6] = "0";
  cols[7] = dotAmountFromLiteral(slot.recap.baseLiteral, slot.recap.baseCents);
  cols[8] = "0";
  cols[9] = "V";
  return cols.join("\t");
}

function renderT00Header(
  receipt: OmegaReceiptDraft,
  slots: VatSlotTotals,
): string {
  const cols = emptyRow(T00_R01_COLUMNS);
  cols[0] = "R01";
  cols[1] = String(receipt.docTypeCode);
  cols[2] = truncateFreeText(receipt.evidenceCode, LIMIT.evidenceCode);
  cols[3] = truncateFreeText(receipt.seriesCode, LIMIT.seriesCode);
  cols[4] = receipt.exportNumber.trim();
  cols[5] = receipt.externalNumber.trim();
  cols[6] = truncateFreeText(receipt.counterparty.name, LIMIT.partnerName);
  cols[7] = receipt.counterparty.ico.trim();
  cols[8] = truncateFreeText(receipt.counterparty.dic.trim(), LIMIT.dic);
  cols[9] = receipt.issueDate.trim();
  cols[10] = receipt.receiptDate.trim();
  cols[11] = receipt.dueDate.trim();
  cols[12] = receipt.taxableSupplyDate.trim();
  cols[13] = receipt.transactionDate.trim();
  cols[14] = receipt.currency.trim() || "EUR";
  if (receipt.foreignCurrency) {
    cols[15] = "1";
    cols[18] = dotAmountFromCents(receipt.totalCents);
  }
  cols[19] = dotAmountFromCents(receipt.totalCents);
  cols[20] = String(slots.lowerRate);
  cols[21] = String(slots.higherRate);
  cols[22] = dotAmountFromCents(slots.lowerBaseCents);
  cols[23] = dotAmountFromCents(slots.higherBaseCents);
  cols[24] = dotAmountFromCents(slots.zeroBaseCents);
  cols[25] = dotAmountFromCents(slots.exemptBaseCents);
  cols[26] = dotAmountFromCents(slots.lowerVatCents);
  cols[27] = dotAmountFromCents(slots.higherVatCents);
  cols[53] = receipt.externalNumber.trim();
  return cols.join("\t");
}

function renderT00Item(
  slot: VatSlotTotals["rowsBySlot"][number],
  receipt: OmegaReceiptDraft,
): string {
  const cols = emptyRow(T00_R02_COLUMNS);
  const lineCents = slot.recap.baseCents + slot.recap.vatCents;
  const rateLabel = slot.recap.rateLiteral.trim() || "?";
  cols[0] = "R02";
  cols[1] = "0";
  cols[6] = dotAmountFromCents(lineCents);
  if (receipt.foreignCurrency) {
    cols[7] = dotAmountFromCents(lineCents);
  }
  cols[8] = truncateFreeText(`Polozka DPH ${rateLabel}%`, 60);
  return cols.join("\t");
}

export function buildOmegaFileLines(input: OmegaExportInput): string[] {
  const plan = planOmegaExport(input);
  const lines: string[] = [];

  const defaultPartners = [
    ...plan.includedInvoices.map((invoice) => invoice.counterparty),
    ...plan.includedReceipts.map((receipt) => receipt.counterparty),
  ];
  const partners = input.partners.length > 0 ? input.partners : defaultPartners;

  const seenPartner = new Set<string>();
  lines.push("R00\tT04");
  for (const partner of partners) {
    if (seenPartner.has(partner.partnerKey)) {
      continue;
    }
    seenPartner.add(partner.partnerKey);
    lines.push(renderT04Partner(partner));
  }

  lines.push("R00\tT01");
  for (const invoice of plan.includedInvoices) {
    const slots = assignVatSlots(invoice.vatRecap);
    lines.push(renderT01Header(invoice, input.settings, slots));
    for (const row of slots.rowsBySlot) {
      lines.push(renderT01Item(row));
    }
  }

  if (plan.includedReceipts.length > 0) {
    lines.push("R00\tT00");
    for (const receipt of plan.includedReceipts) {
      const slots = assignVatSlots(receipt.vatRecap);
      lines.push(renderT00Header(receipt, slots));
      for (const row of slots.rowsBySlot) {
        lines.push(renderT00Item(row, receipt));
      }
    }
  }

  return lines;
}

export function buildOmegaFileBytes(input: OmegaExportInput): Buffer {
  const text = `${buildOmegaFileLines(input).join("\r\n")}\r\n`;
  return iconv.encode(text, "win1250");
}

const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

/** Header columns before the spec's `>>` marker; mandatory on import. */
export const T01_MANDATORY_HEADER_COLUMNS = 17;

export function compareT01DataColumns(
  expectedLine: string,
  actualLine: string,
  opts: {
    ignoreExportNumber?: boolean;
    /**
     * Compare only what the writer filled in. Her own export also carries her
     * internal codes, texts and bank details, which a data-only file never
     * writes (ADR 0019); plain numbers are compared by value, because Omega
     * exports `0.0000` where the writer writes `0`.
     */
    writtenColumnsOnly?: boolean;
  } = {},
): boolean {
  const expected = expectedLine.split("\t");
  const actual = actualLine.split("\t");
  if (expected.length !== actual.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (opts.ignoreExportNumber && index === 1) {
      continue;
    }
    const expectedCell = expected[index]!;
    const actualCell = actual[index]!;
    if (opts.writtenColumnsOnly) {
      if (actualCell === "") {
        if (index < T01_MANDATORY_HEADER_COLUMNS) {
          return false;
        }
        continue;
      }
      if (PLAIN_DECIMAL.test(expectedCell) && PLAIN_DECIMAL.test(actualCell)) {
        if (Number(expectedCell) !== Number(actualCell)) {
          return false;
        }
        continue;
      }
    }
    if (expectedCell !== actualCell) {
      return false;
    }
  }
  return true;
}
