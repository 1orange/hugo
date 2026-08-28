import {
  isValidEkasaOkp,
  isValidEkasaUid,
} from "./ekasa-identifiers";
import {
  bratislavaLocalToUtcIso,
  parseReceiptDatetimeRaw,
} from "./ekasa-timestamp";
import { parseDecimalAmount } from "./money";

export type EkasaTextLine = string;

export type EkasaLineItem = {
  name: string;
  vatRateLiteral: string;
  quantityLiteral: string;
  unitPriceLiteral: string;
  lineTotalLiteral: string;
  lineTotalCents: number;
};

export type EkasaVatRecapRow = {
  rateLiteral: string;
  baseLiteral: string;
  baseCents: number;
  vatLiteral: string;
  vatCents: number;
};

export type EkasaTextReceipt = {
  supplierName: string;
  dic: string;
  ico: string;
  icDph: string;
  kp: string;
  receiptNumber: string;
  timestampRaw: string;
  receiptAtUtc: string;
  totalLiteral: string;
  totalCents: number;
  currency: string;
  okp: string;
  uid: string;
  lineItems: EkasaLineItem[];
  recapRows: EkasaVatRecapRow[];
  recapSpoluBaseLiteral: string;
  recapSpoluBaseCents: number;
  recapSpoluVatLiteral: string;
  recapSpoluVatCents: number;
};

export type EkasaTextParseError = {
  ok: false;
  reason: string;
};

export type EkasaTextParseResult = EkasaTextReceipt | EkasaTextParseError;

const ITEM_RATE_LINE = /^(\d+\.\d)%\s*\|\s*(.+)$/;
const EMBEDDED_ITEM_RATE_LINE = /^(.*)\|\s*(\d+\.\d)%\s*\|\s*(.+)$/;
const ITEM_QTY_LINE = /^([\d.]+)\s*ks\s*\*\s*([\d.]+)$/;
const RECAP_ROW_LINE = /^(\d+\.\d)\s+%\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)$/;
const SPOLU_LINE = /^SPOLU:\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)$/;
const NA_UHRADU_LINE = /NA ÚHRADU\s+([A-Z]{3})\s*\|\s*([\d.]+)/;
const DASH_LINE = /^-+$/;

function parseFailure(reason: string): EkasaTextParseError {
  return { ok: false, reason };
}

function isSkippableLine(line: string): boolean {
  if (line.length === 0) {
    return true;
  }
  if (DASH_LINE.test(line)) {
    return true;
  }
  if (line.includes("DPH REKAPITULÁCIA")) {
    return true;
  }
  if (line === "Sadzba: | Základ: | DPH:") {
    return true;
  }
  if (line.startsWith("Predajné miesto:")) {
    return true;
  }
  if (line === "Elektronická kópia dokladu.") {
    return true;
  }
  if (line === "OVERTE DOKLAD POMOCOU QR KÓDU") {
    return true;
  }
  return false;
}

function parseAmountCell(cell: string): { literal: string; cents: number } | EkasaTextParseError {
  const trimmed = cell.trim().replace(/\s*€\s*$/, "").trim();
  const parsed = parseDecimalAmount(trimmed);
  if ("ok" in parsed) {
    return parseFailure(parsed.reason);
  }
  return { literal: parsed.literal, cents: parsed.cents };
}

function findQtyLineAfterRate(
  lines: string[],
  rateIndex: number,
): { qtyMatch: RegExpExecArray; nameSuffix: string } | null {
  const suffixParts: string[] = [];
  for (let index = rateIndex + 1; index < Math.min(rateIndex + 5, lines.length); index += 1) {
    const candidate = lines[index]!.trim();
    if (candidate.length === 0 || isSkippableLine(candidate)) {
      continue;
    }
    if (NA_UHRADU_LINE.test(candidate)) {
      break;
    }
    const qtyMatch = ITEM_QTY_LINE.exec(candidate);
    if (qtyMatch) {
      return {
        qtyMatch,
        nameSuffix: suffixParts.join(" ").trim(),
      };
    }
    if (
      ITEM_RATE_LINE.test(candidate) ||
      EMBEDDED_ITEM_RATE_LINE.test(candidate)
    ) {
      break;
    }
    suffixParts.push(candidate);
  }
  return null;
}

/**
 * Detect whether grouped PDF text lines look like an eBloček rather than a
 * train ticket, invoice or other document in the bločky folders.
 */
export function isEkasaReceipt(lines: EkasaTextLine[]): boolean {
  const normalized = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  const hasUidMarker = normalized.some((line) => line === "UID:" || line.startsWith("UID:"));
  const hasOkpMarker = normalized.some((line) => line === "OKP:" || line.startsWith("OKP:"));
  const hasTotal = normalized.some((line) => NA_UHRADU_LINE.test(line));
  return hasUidMarker && hasOkpMarker && hasTotal;
}

/**
 * Map grouped eBloček text lines to receipt facts. No file access, no network,
 * no clock — only the line strings.
 */
export function parseEkasaText(lines: EkasaTextLine[]): EkasaTextParseResult {
  const normalized = lines.map((line) => line.trim());

  if (!isEkasaReceipt(normalized)) {
    return parseFailure("Document is not an eBloček (missing UID, OKP or NA ÚHRADU markers).");
  }

  const supplierName = normalized.find((line) => line.length > 0 && !isSkippableLine(line)) ?? "";
  if (!supplierName || supplierName.includes("Predajné miesto")) {
    return parseFailure("Supplier name is missing.");
  }

  let dic = "";
  let ico = "";
  let icDph = "";
  let kp = "";
  let receiptNumber = "";
  let timestampRaw = "";
  let totalLiteral = "";
  let totalCents = 0;
  let currency = "";
  let okp = "";
  let uid = "";
  const lineItems: EkasaLineItem[] = [];
  const recapRows: EkasaVatRecapRow[] = [];
  let recapSpoluBaseLiteral = "";
  let recapSpoluBaseCents = 0;
  let recapSpoluVatLiteral = "";
  let recapSpoluVatCents = 0;

  let inItems = false;
  const pendingNameParts: string[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const line = normalized[index]!;
    if (line.length === 0 || isSkippableLine(line)) {
      continue;
    }

    if (line === "Položky:") {
      inItems = true;
      continue;
    }

    const naUhradu = NA_UHRADU_LINE.exec(line);
    if (naUhradu) {
      inItems = false;
      pendingNameParts.length = 0;
      currency = naUhradu[1]!;
      const total = parseAmountCell(naUhradu[2]!);
      if ("ok" in total) {
        return total;
      }
      totalLiteral = total.literal;
      totalCents = total.cents;
      continue;
    }

    if (line.startsWith("DIČ:")) {
      const dicMatch = /DIČ:\s*(\d+)/.exec(line);
      const icoMatch = /IČO:\s*(\d+)/.exec(line);
      dic = dicMatch?.[1] ?? "";
      ico = icoMatch?.[1] ?? "";
      continue;
    }

    if (line.startsWith("IČDPH:")) {
      const icDphMatch = /IČDPH:\s*([^\s|]+)/.exec(line);
      const kpMatch = /KP:\s*(\d+)/.exec(line);
      icDph = icDphMatch?.[1] ?? "";
      kp = kpMatch?.[1] ?? "";
      continue;
    }

    if (line.startsWith("Dátum a čas:")) {
      timestampRaw = line.replace("Dátum a čas:", "").trim();
      continue;
    }

    if (line.startsWith("Číslo dokladu:")) {
      receiptNumber = line.replace("Číslo dokladu:", "").trim();
      continue;
    }

    if (line === "OKP:") {
      const next = normalized[index + 1]?.trim() ?? "";
      if (!isValidEkasaOkp(next)) {
        return parseFailure("OKP value is missing or malformed.");
      }
      okp = next;
      continue;
    }

    if (line === "UID:") {
      const next = normalized[index + 1]?.trim() ?? "";
      if (!isValidEkasaUid(next)) {
        return parseFailure("UID value is missing or malformed.");
      }
      uid = next;
      continue;
    }

    const spolu = SPOLU_LINE.exec(line);
    if (spolu) {
      const base = parseAmountCell(spolu[1]!);
      if ("ok" in base) {
        return base;
      }
      const vat = parseAmountCell(spolu[2]!);
      if ("ok" in vat) {
        return vat;
      }
      recapSpoluBaseLiteral = base.literal;
      recapSpoluBaseCents = base.cents;
      recapSpoluVatLiteral = vat.literal;
      recapSpoluVatCents = vat.cents;
      continue;
    }

    const recap = RECAP_ROW_LINE.exec(line);
    if (recap) {
      const base = parseAmountCell(recap[2]!);
      if ("ok" in base) {
        return base;
      }
      const vat = parseAmountCell(recap[3]!);
      if ("ok" in vat) {
        return vat;
      }
      recapRows.push({
        rateLiteral: recap[1]!,
        baseLiteral: base.literal,
        baseCents: base.cents,
        vatLiteral: vat.literal,
        vatCents: vat.cents,
      });
      continue;
    }

    if (!inItems || totalLiteral.length > 0) {
      continue;
    }

    const embeddedRate = EMBEDDED_ITEM_RATE_LINE.exec(line);
    if (embeddedRate) {
      const total = parseAmountCell(embeddedRate[3]!);
      if ("ok" in total) {
        return total;
      }
      const qtyResult = findQtyLineAfterRate(normalized, index);
      if (!qtyResult) {
        return parseFailure(
          `Item "${embeddedRate[1]!.trim()}" is missing quantity line.`,
        );
      }
      lineItems.push({
        name: embeddedRate[1]!.trim(),
        vatRateLiteral: embeddedRate[2]!,
        quantityLiteral: qtyResult.qtyMatch[1]!,
        unitPriceLiteral: qtyResult.qtyMatch[2]!,
        lineTotalLiteral: total.literal,
        lineTotalCents: total.cents,
      });
      pendingNameParts.length = 0;
      continue;
    }

    const rateLine = ITEM_RATE_LINE.exec(line);
    if (rateLine) {
      const name = pendingNameParts.join(" ").trim();
      if (!name) {
        return parseFailure("Item name is missing before rate line.");
      }
      const total = parseAmountCell(rateLine[2]!);
      if ("ok" in total) {
        return total;
      }
      const qtyResult = findQtyLineAfterRate(normalized, index);
      if (!qtyResult) {
        return parseFailure(`Item "${name}" is missing quantity line.`);
      }
      const fullName = qtyResult.nameSuffix
        ? `${name} ${qtyResult.nameSuffix}`
        : name;
      lineItems.push({
        name: fullName,
        vatRateLiteral: rateLine[1]!,
        quantityLiteral: qtyResult.qtyMatch[1]!,
        unitPriceLiteral: qtyResult.qtyMatch[2]!,
        lineTotalLiteral: total.literal,
        lineTotalCents: total.cents,
      });
      pendingNameParts.length = 0;
      continue;
    }

    if (
      !ITEM_QTY_LINE.test(line) &&
      !line.startsWith("DIČ:") &&
      !RECAP_ROW_LINE.test(line) &&
      !SPOLU_LINE.test(line)
    ) {
      pendingNameParts.push(line);
    }
  }

  if (!timestampRaw) {
    return parseFailure("Receipt timestamp is missing.");
  }
  if (!totalLiteral) {
    return parseFailure("NA ÚHRADU total is missing.");
  }
  if (!okp) {
    return parseFailure("OKP is missing.");
  }
  if (!uid) {
    return parseFailure("UID is missing.");
  }
  if (lineItems.length === 0) {
    return parseFailure("No line items were parsed.");
  }
  if (!recapSpoluBaseLiteral) {
    return parseFailure("SPOLU recap row is missing.");
  }

  const timestamp = parseReceiptDatetimeRaw(timestampRaw);
  if ("ok" in timestamp) {
    return parseFailure(timestamp.reason);
  }

  return {
    supplierName,
    dic,
    ico,
    icDph,
    kp,
    receiptNumber,
    timestampRaw,
    receiptAtUtc: bratislavaLocalToUtcIso(timestamp),
    totalLiteral,
    totalCents,
    currency,
    okp,
    uid,
    lineItems,
    recapRows,
    recapSpoluBaseLiteral,
    recapSpoluBaseCents,
    recapSpoluVatLiteral,
    recapSpoluVatCents,
  };
}

/**
 * Arithmetic self-checks on parsed receipt facts. A mismatch means the text was
 * misread — never create a payment silently.
 */
export function validateEkasaArithmetic(
  receipt: EkasaTextReceipt,
): { ok: true } | { ok: false; reason: string } {
  const itemSum = receipt.lineItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  if (itemSum !== receipt.totalCents) {
    const itemTotal = (itemSum / 100).toFixed(2);
    return {
      ok: false,
      reason: `Item line totals sum to ${itemTotal} but NA ÚHRADU is ${receipt.totalLiteral}.`,
    };
  }

  const recapBaseSum = receipt.recapRows.reduce((sum, row) => sum + row.baseCents, 0);
  const recapVatSum = receipt.recapRows.reduce((sum, row) => sum + row.vatCents, 0);
  if (recapBaseSum !== receipt.recapSpoluBaseCents || recapVatSum !== receipt.recapSpoluVatCents) {
    return {
      ok: false,
      reason: "Recapitulation rows do not sum to SPOLU.",
    };
  }

  const spoluTotal = receipt.recapSpoluBaseCents + receipt.recapSpoluVatCents;
  if (spoluTotal !== receipt.totalCents) {
    const spoluLiteral = (spoluTotal / 100).toFixed(2);
    return {
      ok: false,
      reason: `SPOLU base + VAT equals ${spoluLiteral} but NA ÚHRADU is ${receipt.totalLiteral}.`,
    };
  }

  return { ok: true };
}
