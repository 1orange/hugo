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

/**
 * An invoice settled by an advance (ADR 0017 amendment, 2026-11-11): the
 * payload's amount and VAT recap are the supply; the advance deducted and the
 * amount due are kept beside them, and the deduction's own recap rows for audit.
 */
export type AdvanceSettlementPayload = {
  /** `detected` from the text; `manual` when she marked the invoice settled. */
  source: "detected" | "manual";
  /** `extracted` when the supply total is a printed gross total; `derived` when summed from the supply rows. */
  totalProvenance: "extracted" | "derived";
  advanceDeductedCents: number;
  advanceDeductedLiteral: string;
  amountDueCents: number;
  amountDueLiteral: string;
  advanceDocumentNumbers: string[];
  /** Recap rows of the deduction. Never used for VAT. */
  settlementRows: DocumentVatRecapRow[];
  /**
   * The amount and recap as the model read them, before the settlement. Kept so
   * that marking the invoice not settled restores the plain extraction. Absent
   * on results read before they were kept.
   */
  originalAmountCents?: number | null;
  originalAmountLiteral?: string | null;
  originalVatRecap?: DocumentVatRecapRow[];
  /** Set when the printed amount due does not follow from total − advance (informational). */
  identityWarning?: string | null;
  /** What she should look at, other than the identity; in Slovak. */
  findings?: string[];
};

/** Her decision on whether the invoice is settled by an advance; it wins over detection (ADR 0010). */
export type AdvanceSettlementOverride = {
  settled: boolean;
  source: "manual";
};

export type ModelExtractedPayload = {
  kind: "extracted";
  /**
   * "isdoc" and "mol": read from the invoice embedded in the PDF as data — an
   * ISDOC, a MOL e-invoice — not by a model.
   */
  source?: "model" | "ocr" | "isdoc" | "mol";
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
  /**
   * A document among the receipts that prints no eKasa mark: a parking
   * machine's ticket, a train ticket, an invoice paid by card. Booked like
   * the rest of the folder, but there is no UID to ask her for.
   */
  outsideEkasa?: true;
  /** The UID she typed into the UID box, kept even when the lookup knew nothing. */
  typedEkasaUid?: string;
  /** Set when an advance was deducted: amount and vatRecap are then the supply. */
  advanceSettlement?: AdvanceSettlementPayload;
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
  /** Her decision on the advance settlement, over what the text shows. */
  advanceSettlement?: AdvanceSettlementOverride;
  /**
   * Where each confirmed party value came from, recorded when she swaps the
   * parties: the values themselves are her correction, but their badges keep
   * the source they were read from. Absent means every confirmed value is hers.
   */
  partyProvenance?: Partial<
    Record<
      | "supplierName"
      | "ico"
      | "dic"
      | "icDph"
      | "customerName"
      | "customerIco"
      | "customerDic"
      | "customerIcDph",
      "empty" | "extracted" | "confirmed" | "profile" | "derived" | "register" | "directory"
    >
  >;
  /** Field-level dependency metadata for values calculated by the pipeline. */
  derived?: Record<
    string,
    {
      dependencies: string[];
      /** Snapshot used to invalidate folder/profile-dependent derivations. */
      dependencyValues?: Record<string, string>;
    }
  >;
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
