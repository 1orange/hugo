export type DocumentLineItem = {
  sortOrder: number;
  name: string;
  vatRateLiteral: string;
  quantityLiteral: string;
  unitPriceLiteral: string;
  lineTotalLiteral: string;
  lineTotalCents: number;
};

export type DocumentVatRecapRow = {
  rateLiteral: string;
  baseLiteral: string;
  baseCents: number;
  vatLiteral: string;
  vatCents: number;
};

export type EkasaExtractedPayload = {
  kind: "ekasa";
  amountCents: number | null;
  amountLiteral: string | null;
  currency: string;
  receiptAt: string | null;
  receiptTimestampRaw: string | null;
  ekasaUid: string | null;
  ekasaOkp: string | null;
  supplierName: string | null;
  dic: string | null;
  ico: string | null;
  icDph: string | null;
  kp: string | null;
  receiptNumber: string | null;
  recapBaseCents: number | null;
  recapBaseLiteral: string | null;
  recapVatCents: number | null;
  recapVatLiteral: string | null;
  lineItems: DocumentLineItem[];
  vatRecap: DocumentVatRecapRow[];
};

export type ExtractedPayload = EkasaExtractedPayload | Record<string, never>;

export function emptyExtractedPayload(): ExtractedPayload {
  return {};
}

export function parseExtractedPayload(json: string): ExtractedPayload {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ExtractedPayload;
    }
  } catch {
    // ponytail: corrupt rows render as empty payload
  }
  return {};
}

export function isEkasaPayload(
  payload: ExtractedPayload,
): payload is EkasaExtractedPayload {
  return "kind" in payload && payload.kind === "ekasa";
}

export function serializeExtractedPayload(payload: ExtractedPayload): string {
  return JSON.stringify(payload);
}

/** Her corrections — partial; only saved fields are written. */
export type ConfirmedPayload = {
  supplierName?: string | null;
  dic?: string | null;
  ico?: string | null;
  icDph?: string | null;
  receiptNumber?: string | null;
  receiptAt?: string | null;
  receiptTimestampRaw?: string | null;
  currency?: string | null;
  amountCents?: number | null;
  amountLiteral?: string | null;
  recapBaseCents?: number | null;
  recapBaseLiteral?: string | null;
  recapVatCents?: number | null;
  recapVatLiteral?: string | null;
  vatRecap?: DocumentVatRecapRow[];
};

export function emptyConfirmedPayload(): ConfirmedPayload {
  return {};
}

export function parseConfirmedPayload(json: string): ConfirmedPayload {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ConfirmedPayload;
    }
  } catch {
    // ponytail: corrupt rows render as empty confirmed payload
  }
  return {};
}

export function serializeConfirmedPayload(payload: ConfirmedPayload): string {
  return JSON.stringify(payload);
}
