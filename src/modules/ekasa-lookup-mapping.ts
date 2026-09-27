import { cashRoundingCents } from "./cash-rounding";
import {
  bratislavaLocalToUtcIso,
  parseReceiptDatetimeRaw,
} from "./ekasa-timestamp";
import type { EkasaExtractedPayload } from "./document-payload";
import { formatEuroFromCents, parseDecimalAmount } from "./money";

export type OpdReceiptItem = {
  name?: string;
  itemType?: string;
  quantity?: number;
  vatRate?: number;
  price?: number;
};

export type OpdReceipt = {
  receiptId?: string;
  okp?: string;
  issueDate?: string;
  createDate?: string;
  dic?: string;
  ico?: string;
  icDph?: string;
  cashRegisterCode?: string;
  receiptNumber?: number | string;
  totalPrice?: number;
  items?: OpdReceiptItem[];
  organization?: {
    name?: string;
  };
};

export type OpdFindResponse = {
  returnValue?: number;
  receipt?: OpdReceipt;
};

export type EkasaLookupMappingError = {
  ok: false;
  reason: string;
};

export type EkasaLookupMappingSuccess = {
  ok: true;
  payload: EkasaExtractedPayload;
};

export type EkasaLookupMappingResult =
  | EkasaLookupMappingSuccess
  | EkasaLookupMappingError;

function mappingFailure(reason: string): EkasaLookupMappingError {
  return { ok: false, reason };
}

function normalizeRateKey(rate: number): string {
  if (!Number.isFinite(rate)) {
    return "invalid";
  }
  const rounded = Math.round(rate * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) {
    return String(Math.round(rounded));
  }
  return String(rounded);
}

function decimalToCents(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const negative = value < 0;
  const literal = Math.abs(value).toFixed(2);
  const parsed = parseDecimalAmount(literal);
  if ("ok" in parsed) {
    return null;
  }
  return negative ? -parsed.cents : parsed.cents;
}

function vatFromGrossCents(
  grossCents: number,
  rate: number,
): { baseCents: number; vatCents: number } {
  const grossEuro = grossCents / 100;
  const vatEuro =
    Math.round(((grossEuro * rate) / (100 + rate)) * 100) / 100;
  const vatCents = Math.round(vatEuro * 100);
  return { baseCents: grossCents - vatCents, vatCents };
}

function unwrapOpdResponse(raw: unknown): OpdReceipt | EkasaLookupMappingError {
  if (!raw || typeof raw !== "object") {
    return mappingFailure("OPD response is not an object.");
  }
  const envelope = raw as OpdFindResponse;
  if (envelope.receipt && typeof envelope.receipt === "object") {
    return envelope.receipt;
  }
  const direct = raw as OpdReceipt;
  if (direct.receiptId) {
    return direct;
  }
  return mappingFailure("OPD response has no receipt.");
}

export function organizationNameFromOpd(raw: unknown): string | null {
  const unwrapped = unwrapOpdResponse(raw);
  if ("ok" in unwrapped) {
    return null;
  }
  const name = unwrapped.organization?.name?.trim() ?? "";
  return name.length > 0 ? name : null;
}

export function mapOpdResponseToEkasaPayload(input: {
  requestedUid: string;
  raw: unknown;
}): EkasaLookupMappingResult {
  const unwrapped = unwrapOpdResponse(input.raw);
  if ("ok" in unwrapped) {
    return unwrapped;
  }
  const receipt = unwrapped;

  const receiptId = receipt.receiptId?.trim().toUpperCase() ?? "";
  const requested = input.requestedUid.trim().toUpperCase();
  if (!receiptId || receiptId !== requested) {
    return mappingFailure("OPD receiptId does not match the requested UID.");
  }

  if (typeof receipt.totalPrice !== "number" || !Number.isFinite(receipt.totalPrice)) {
    return mappingFailure("OPD totalPrice is missing.");
  }

  const totalCents = decimalToCents(receipt.totalPrice);
  if (totalCents === null) {
    return mappingFailure("OPD totalPrice is not a valid amount.");
  }

  const items = receipt.items ?? [];
  if (items.length === 0) {
    return mappingFailure("OPD receipt has no items.");
  }

  let itemSumCents = 0;
  const lineItems: EkasaExtractedPayload["lineItems"] = [];
  // Gross per rate, split into base and VAT once per rate as the cash register
  // does: rounding each item first drifts by a cent (IKEA, 4 items: 8.94 vs 8.95).
  const grossByRate = new Map<
    string,
    { rateLiteral: string; rate: number; grossCents: number }
  >();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (typeof item.price !== "number" || !Number.isFinite(item.price)) {
      return mappingFailure(`OPD item ${index + 1} has no price.`);
    }
    if (typeof item.vatRate !== "number" || !Number.isFinite(item.vatRate)) {
      return mappingFailure(`OPD item ${index + 1} has no VAT rate.`);
    }

    const lineTotalCents = decimalToCents(item.price);
    if (lineTotalCents === null) {
      return mappingFailure(`OPD item ${index + 1} price is not a valid amount.`);
    }
    itemSumCents += lineTotalCents;

    const rateKey = normalizeRateKey(item.vatRate);
    const existing = grossByRate.get(rateKey);
    if (existing) {
      existing.grossCents += lineTotalCents;
    } else {
      grossByRate.set(rateKey, {
        rateLiteral: rateKey.includes(".") ? rateKey : `${rateKey}.0`,
        rate: item.vatRate,
        grossCents: lineTotalCents,
      });
    }

    const quantity =
      typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? item.quantity
        : 1;
    const unitPrice = quantity !== 0 ? item.price / quantity : item.price;

    lineItems.push({
      sortOrder: index,
      name: item.name?.trim() ?? "",
      vatRateLiteral: rateKey.includes(".") ? rateKey : `${rateKey}.0`,
      quantityLiteral: String(quantity),
      unitPriceLiteral: unitPrice.toFixed(2),
      lineTotalLiteral: formatEuroFromCents(lineTotalCents),
      lineTotalCents,
    });
  }

  // A cash payment's total is the items rounded to 5 cents; anything else is a mismatch.
  if (
    cashRoundingCents({
      itemsTotalCents: itemSumCents,
      payableCents: totalCents,
      currency: "EUR",
    }) === null
  ) {
    return mappingFailure(
      `OPD item prices sum to ${formatEuroFromCents(itemSumCents)} but totalPrice is ${formatEuroFromCents(totalCents)}, which is not their cash rounding.`,
    );
  }

  const timestampRaw = (receipt.issueDate ?? receipt.createDate ?? "").trim();
  const timestamp = parseReceiptDatetimeRaw(timestampRaw);
  if ("ok" in timestamp) {
    return mappingFailure(timestamp.reason);
  }

  const vatRecap = [...grossByRate.values()]
    .sort((a, b) => a.rate - b.rate)
    .map((row) => {
      const { baseCents, vatCents } = vatFromGrossCents(row.grossCents, row.rate);
      return {
        rateLiteral: row.rateLiteral,
        baseLiteral: formatEuroFromCents(baseCents),
        baseCents,
        vatLiteral: formatEuroFromCents(vatCents),
        vatCents,
      };
    });

  const recapBaseCents = vatRecap.reduce((sum, row) => sum + row.baseCents, 0);
  const recapVatCents = vatRecap.reduce((sum, row) => sum + row.vatCents, 0);

  const supplierName =
    receipt.organization?.name?.trim() ??
    "";

  const payload: EkasaExtractedPayload = {
    kind: "ekasa",
    source: "lookup",
    opdResponse: input.raw,
    amountCents: totalCents,
    amountLiteral: formatEuroFromCents(totalCents),
    currency: "EUR",
    receiptAt: bratislavaLocalToUtcIso(timestamp),
    receiptTimestampRaw: timestampRaw,
    ekasaUid: receiptId,
    ekasaOkp: receipt.okp ?? null,
    supplierName: supplierName.length > 0 ? supplierName : null,
    dic: receipt.dic ?? null,
    ico: receipt.ico ?? null,
    icDph: receipt.icDph ?? null,
    kp: receipt.cashRegisterCode ?? null,
    receiptNumber:
      receipt.receiptNumber !== undefined && receipt.receiptNumber !== null
        ? String(receipt.receiptNumber)
        : null,
    recapBaseCents,
    recapBaseLiteral: formatEuroFromCents(recapBaseCents),
    recapVatCents,
    recapVatLiteral: formatEuroFromCents(recapVatCents),
    lineItems,
    vatRecap,
  };

  return { ok: true, payload };
}
