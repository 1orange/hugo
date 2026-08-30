import {
  bratislavaLocalToUtcIso,
  parseReceiptDatetimeRaw,
} from "./ekasa-timestamp";
import { parseDecimalAmount } from "./money";
import type {
  ConfirmedPayload,
  DocumentVatRecapRow,
  EkasaExtractedPayload,
  ExtractedPayload,
} from "./document-payload";
import { isEkasaPayload } from "./document-payload";

export type EditableDocumentFields = {
  supplierName: string;
  ico: string;
  dic: string;
  icDph: string;
  receiptNumber: string;
  receiptTimestampRaw: string;
  receiptAt: string | null;
  currency: string;
  amountLiteral: string;
  amountCents: number | null;
  recapBaseLiteral: string;
  recapBaseCents: number | null;
  recapVatLiteral: string;
  recapVatCents: number | null;
  vatRecap: DocumentVatRecapRow[];
};

export type FieldProvenance = "confirmed" | "extracted" | "empty";

export type ScalarFieldKey =
  | "supplierName"
  | "ico"
  | "dic"
  | "icDph"
  | "receiptNumber"
  | "receiptTimestampRaw"
  | "currency"
  | "amountLiteral"
  | "recapBaseLiteral"
  | "recapVatLiteral";

export type FieldProvenanceMap = Record<ScalarFieldKey, FieldProvenance> & {
  vatRecap: FieldProvenance;
};

export type MergedDocumentFields = {
  fields: EditableDocumentFields;
  provenance: FieldProvenanceMap;
  nonEurCurrency: boolean;
};

export type DocumentFieldFormInput = {
  supplierName: string;
  ico: string;
  dic: string;
  icDph: string;
  receiptNumber: string;
  receiptTimestampRaw: string;
  currency: string;
  amountLiteral: string;
  recapBaseLiteral: string;
  recapVatLiteral: string;
  vatRecap: Array<{
    rateLiteral: string;
    baseLiteral: string;
    vatLiteral: string;
  }>;
};

export type ParseConfirmedFieldsResult =
  | { ok: true; payload: ConfirmedPayload }
  | { ok: false; reason: string };

function extractedEditableFields(
  extracted: ExtractedPayload,
): Partial<EditableDocumentFields> {
  if (!isEkasaPayload(extracted)) {
    return {};
  }
  return {
    supplierName: extracted.supplierName ?? "",
    ico: extracted.ico ?? "",
    dic: extracted.dic ?? "",
    icDph: extracted.icDph ?? "",
    receiptNumber: extracted.receiptNumber ?? "",
    receiptTimestampRaw: extracted.receiptTimestampRaw ?? "",
    receiptAt: extracted.receiptAt,
    currency: extracted.currency ?? "",
    amountLiteral: extracted.amountLiteral ?? "",
    amountCents: extracted.amountCents,
    recapBaseLiteral: extracted.recapBaseLiteral ?? "",
    recapBaseCents: extracted.recapBaseCents,
    recapVatLiteral: extracted.recapVatLiteral ?? "",
    recapVatCents: extracted.recapVatCents,
    vatRecap: extracted.vatRecap ?? [],
  };
}

function hasConfirmedScalar(
  confirmed: ConfirmedPayload,
  key: ScalarFieldKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(confirmed, key);
}

function scalarFromConfirmed(
  confirmed: ConfirmedPayload,
  key: ScalarFieldKey,
): string {
  const value = confirmed[key];
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function mergeScalar(
  key: ScalarFieldKey,
  extracted: Partial<EditableDocumentFields>,
  confirmed: ConfirmedPayload,
): { value: string; provenance: FieldProvenance } {
  if (hasConfirmedScalar(confirmed, key)) {
    return { value: scalarFromConfirmed(confirmed, key), provenance: "confirmed" };
  }
  const extractedValue = extracted[key];
  if (typeof extractedValue === "string" && extractedValue.length > 0) {
    return { value: extractedValue, provenance: "extracted" };
  }
  return { value: "", provenance: "empty" };
}

function mergeMoneyLiteral(
  literalKey: "amountLiteral" | "recapBaseLiteral" | "recapVatLiteral",
  centsKey: "amountCents" | "recapBaseCents" | "recapVatCents",
  extracted: Partial<EditableDocumentFields>,
  confirmed: ConfirmedPayload,
): { literal: string; cents: number | null; provenance: FieldProvenance } {
  if (hasConfirmedScalar(confirmed, literalKey)) {
    const literal = scalarFromConfirmed(confirmed, literalKey);
    const cents = confirmed[centsKey] ?? null;
    return { literal, cents, provenance: "confirmed" };
  }
  const literal = extracted[literalKey];
  if (typeof literal === "string" && literal.length > 0) {
    return {
      literal,
      cents: extracted[centsKey] ?? null,
      provenance: "extracted",
    };
  }
  return { literal: "", cents: null, provenance: "empty" };
}

export function mergeDocumentFields(
  extracted: ExtractedPayload,
  confirmed: ConfirmedPayload,
): MergedDocumentFields {
  const fromExtracted = extractedEditableFields(extracted);

  const supplier = mergeScalar("supplierName", fromExtracted, confirmed);
  const ico = mergeScalar("ico", fromExtracted, confirmed);
  const dic = mergeScalar("dic", fromExtracted, confirmed);
  const icDph = mergeScalar("icDph", fromExtracted, confirmed);
  const receiptNumber = mergeScalar("receiptNumber", fromExtracted, confirmed);
  const receiptTimestampRaw = mergeScalar(
    "receiptTimestampRaw",
    fromExtracted,
    confirmed,
  );
  const currency = mergeScalar("currency", fromExtracted, confirmed);
  const amount = mergeMoneyLiteral(
    "amountLiteral",
    "amountCents",
    fromExtracted,
    confirmed,
  );
  const recapBase = mergeMoneyLiteral(
    "recapBaseLiteral",
    "recapBaseCents",
    fromExtracted,
    confirmed,
  );
  const recapVat = mergeMoneyLiteral(
    "recapVatLiteral",
    "recapVatCents",
    fromExtracted,
    confirmed,
  );

  let vatRecap: DocumentVatRecapRow[];
  let vatRecapProvenance: FieldProvenance;
  if (Object.prototype.hasOwnProperty.call(confirmed, "vatRecap")) {
    vatRecap = confirmed.vatRecap ?? [];
    vatRecapProvenance = "confirmed";
  } else if ((fromExtracted.vatRecap?.length ?? 0) > 0) {
    vatRecap = fromExtracted.vatRecap!;
    vatRecapProvenance = "extracted";
  } else {
    vatRecap = [];
    vatRecapProvenance = "empty";
  }

  let receiptAt: string | null = null;
  if (Object.prototype.hasOwnProperty.call(confirmed, "receiptAt")) {
    receiptAt = confirmed.receiptAt ?? null;
  } else {
    receiptAt = fromExtracted.receiptAt ?? null;
  }

  const effectiveCurrency = currency.value || "EUR";

  return {
    fields: {
      supplierName: supplier.value,
      ico: ico.value,
      dic: dic.value,
      icDph: icDph.value,
      receiptNumber: receiptNumber.value,
      receiptTimestampRaw: receiptTimestampRaw.value,
      receiptAt,
      currency: effectiveCurrency,
      amountLiteral: amount.literal,
      amountCents: amount.cents,
      recapBaseLiteral: recapBase.literal,
      recapBaseCents: recapBase.cents,
      recapVatLiteral: recapVat.literal,
      recapVatCents: recapVat.cents,
      vatRecap,
    },
    provenance: {
      supplierName: supplier.provenance,
      ico: ico.provenance,
      dic: dic.provenance,
      icDph: icDph.provenance,
      receiptNumber: receiptNumber.provenance,
      receiptTimestampRaw: receiptTimestampRaw.provenance,
      currency: currency.provenance,
      amountLiteral: amount.provenance,
      recapBaseLiteral: recapBase.provenance,
      recapVatLiteral: recapVat.provenance,
      vatRecap: vatRecapProvenance,
    },
    nonEurCurrency:
      effectiveCurrency.length > 0 && effectiveCurrency !== "EUR",
  };
}

function parseOptionalMoney(
  literal: string,
  label: string,
): { literal: string; cents: number } | { ok: false; reason: string } {
  const trimmed = literal.trim();
  if (trimmed.length === 0) {
    return { literal: "", cents: 0 };
  }
  const parsed = parseDecimalAmount(trimmed);
  if ("ok" in parsed) {
    return { ok: false, reason: `${label} must be a decimal amount.` };
  }
  return { literal: parsed.literal, cents: parsed.cents };
}

export function parseConfirmedFieldsFromInput(
  input: DocumentFieldFormInput,
): ParseConfirmedFieldsResult {
  const amount = parseOptionalMoney(input.amountLiteral, "Total");
  if ("ok" in amount) {
    return amount;
  }
  const recapBase = parseOptionalMoney(input.recapBaseLiteral, "VAT base total");
  if ("ok" in recapBase) {
    return recapBase;
  }
  const recapVat = parseOptionalMoney(input.recapVatLiteral, "VAT total");
  if ("ok" in recapVat) {
    return recapVat;
  }

  const vatRecap: DocumentVatRecapRow[] = [];
  for (const row of input.vatRecap) {
    if (
      row.rateLiteral.trim().length === 0 &&
      row.baseLiteral.trim().length === 0 &&
      row.vatLiteral.trim().length === 0
    ) {
      continue;
    }
    if (row.rateLiteral.trim().length === 0) {
      return { ok: false, reason: "Each VAT row needs a rate." };
    }
    const base = parseOptionalMoney(row.baseLiteral, "VAT base");
    if ("ok" in base) {
      return base;
    }
    const vat = parseOptionalMoney(row.vatLiteral, "VAT amount");
    if ("ok" in vat) {
      return vat;
    }
    vatRecap.push({
      rateLiteral: row.rateLiteral.trim(),
      baseLiteral: base.literal,
      baseCents: base.cents,
      vatLiteral: vat.literal,
      vatCents: vat.cents,
    });
  }

  const currency = input.currency.trim().toUpperCase() || "EUR";
  const receiptTimestampRaw = input.receiptTimestampRaw.trim();
  let receiptAt: string | null = null;
  if (receiptTimestampRaw.length > 0) {
    // An invoice carries a date and no time, so require only the date and treat
    // it as local midnight. Extraction keeps the strict form: a receipt whose
    // printed time cannot be read should fail rather than invent one.
    const withTime = /^\d{2}\.\d{2}\.\d{4}$/.test(receiptTimestampRaw)
      ? `${receiptTimestampRaw} 00:00:00`
      : receiptTimestampRaw;
    const timestamp = parseReceiptDatetimeRaw(withTime);
    if ("ok" in timestamp) {
      return {
        ok: false,
        reason: "Date must be DD.MM.YYYY, optionally followed by HH:MM:SS.",
      };
    }
    receiptAt = bratislavaLocalToUtcIso(timestamp);
  }

  const payload: ConfirmedPayload = {
    supplierName: input.supplierName.trim() || null,
    ico: input.ico.trim() || null,
    dic: input.dic.trim() || null,
    icDph: input.icDph.trim() || null,
    receiptNumber: input.receiptNumber.trim() || null,
    receiptTimestampRaw: receiptTimestampRaw || null,
    receiptAt,
    currency,
    amountLiteral: amount.literal || null,
    amountCents: amount.literal ? amount.cents : null,
    recapBaseLiteral: recapBase.literal || null,
    recapBaseCents: recapBase.literal ? recapBase.cents : null,
    recapVatLiteral: recapVat.literal || null,
    recapVatCents: recapVat.literal ? recapVat.cents : null,
    vatRecap,
  };

  return { ok: true, payload };
}

export function checkArithmeticWarning(
  fields: EditableDocumentFields,
): string | null {
  if (fields.amountCents === null) {
    return null;
  }
  if (fields.recapBaseCents === null || fields.recapVatCents === null) {
    return null;
  }
  const sum = fields.recapBaseCents + fields.recapVatCents;
  if (sum === fields.amountCents) {
    return null;
  }
  const sumLiteral = (sum / 100).toFixed(2);
  return `VAT base (${fields.recapBaseLiteral}) plus VAT (${fields.recapVatLiteral}) equals ${sumLiteral}, but the total is ${fields.amountLiteral}.`;
}

export function effectiveAmountDisplay(fields: EditableDocumentFields): string {
  if (fields.amountLiteral) {
    return `${fields.amountLiteral} ${fields.currency}`;
  }
  return "—";
}

export function isEkasaExtractedPayload(
  payload: ExtractedPayload,
): payload is EkasaExtractedPayload {
  return isEkasaPayload(payload);
}
