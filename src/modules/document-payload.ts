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

export type DocumentParty = {
  name: string | null;
  ico: string | null;
  dic: string | null;
  icDph: string | null;
};

export type DocTypeHint =
  | "invoice"
  | "receipt"
  | "proforma"
  | "credit_note"
  | "advance_tax_document"
  | "other";

export type EkasaExtractionSource = "lookup" | "text-layer";

export type EkasaExtractedPayload = {
  kind: "ekasa";
  source?: EkasaExtractionSource;
  /** Raw OPD JSON — cache and audit trail; fiscal receipts do not change. */
  opdResponse?: unknown;
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
  /** The UID she typed into the UID box, kept even when the lookup knew nothing. */
  typedEkasaUid?: string;
};

import type { ExtractionCheckFlags } from "./extraction-checks";

export type ModelExtractedPayload = {
  kind: "extracted";
  /** "isdoc": read from the structured invoice embedded in the PDF, not by a model. */
  source?: "model" | "ocr" | "isdoc";
  parties: DocumentParty[];
  documentNumber: string | null;
  variableSymbol: string | null;
  issueDate: string | null;
  taxableSupplyDate: string | null;
  dueDate: string | null;
  currency: string;
  amountCents: number | null;
  amountLiteral: string | null;
  vatRecap: DocumentVatRecapRow[];
  docTypeHint: DocTypeHint | null;
  /** Set when extraction checks ran (model / OCR path). */
  fieldChecks?: ExtractionCheckFlags;
  /** The UID she typed into the UID box, kept even when the lookup knew nothing. */
  typedEkasaUid?: string;
};

/** No parser produced data; she fills the document in, possibly after typing a UID. */
export type EmptyExtractedPayload = {
  kind?: undefined;
  /** The UID she typed into the UID box, kept even when the lookup knew nothing. */
  typedEkasaUid?: string;
};

export type ExtractedPayload =
  | EkasaExtractedPayload
  | ModelExtractedPayload
  | EmptyExtractedPayload;

export function emptyExtractedPayload(): ExtractedPayload {
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExtractedPayload(json: string): ExtractedPayload {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) {
      return {};
    }
    if (parsed.kind === "ekasa") {
      return parsed as EkasaExtractedPayload;
    }
    if (parsed.kind === "extracted") {
      return parsed as ModelExtractedPayload;
    }
    return parsed as ExtractedPayload;
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

export function isModelExtractedPayload(
  payload: ExtractedPayload,
): payload is ModelExtractedPayload {
  return "kind" in payload && payload.kind === "extracted";
}

export function getTypedEkasaUid(payload: ExtractedPayload): string | null {
  if (isEkasaPayload(payload) && payload.ekasaUid) {
    return payload.ekasaUid;
  }
  if (
    "typedEkasaUid" in payload &&
    typeof payload.typedEkasaUid === "string" &&
    payload.typedEkasaUid.length > 0
  ) {
    return payload.typedEkasaUid;
  }
  return null;
}

export function hasEkasaLookupPayload(payload: ExtractedPayload): boolean {
  return isEkasaPayload(payload) && payload.source === "lookup";
}

export function withTypedEkasaUid(
  payload: ExtractedPayload,
  uid: string,
): ExtractedPayload {
  return { ...(payload as Record<string, unknown>), typedEkasaUid: uid } as ExtractedPayload;
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
  customerName?: string | null;
  customerDic?: string | null;
  customerIco?: string | null;
  customerIcDph?: string | null;
  receiptNumber?: string | null;
  documentNumber?: string | null;
  variableSymbol?: string | null;
  receiptAt?: string | null;
  receiptTimestampRaw?: string | null;
  issueDateRaw?: string | null;
  issueDateAt?: string | null;
  taxableSupplyDateRaw?: string | null;
  taxableSupplyDateAt?: string | null;
  dueDateRaw?: string | null;
  dueDateAt?: string | null;
  currency?: string | null;
  amountCents?: number | null;
  amountLiteral?: string | null;
  recapBaseCents?: number | null;
  recapBaseLiteral?: string | null;
  recapVatCents?: number | null;
  recapVatLiteral?: string | null;
  vatRecap?: DocumentVatRecapRow[];
  /** Forces T01 vs T00 in the Omega export when set. */
  exportSection?: "T01" | "T00" | null;
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
