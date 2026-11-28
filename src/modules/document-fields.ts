import {
  bratislavaLocalToUtcIso,
  parseReceiptDatetimeRaw,
} from "./ekasa-timestamp";
import { cashRoundingCents } from "./cash-rounding";
import { parseDecimalAmount } from "./money";
import { homeCurrencyForCountry, type HomeCurrency } from "./company-profile";
import type {
  AdvanceSettlementPayload,
  ConfirmedPayload,
  DocumentVatRecapRow,
  EkasaExtractedPayload,
  ExtractedPayload,
} from "./document-payload";
import { isEkasaPayload, isModelExtractedPayload } from "./document-payload";
import { applyAdvanceOverride } from "./advance-settlement";
import {
  assignPartiesFromExtracted,
  validateLabeledPartyRoles,
  type ClientIdentity,
} from "./party-roles";
import {
  enrichInvoiceParties,
  fillFromDirectory,
  partySourceFromValues,
  type DirectoryFactsByKey,
  type DirectoryPartyFacts,
  type PartyField,
  type PartySource,
  type PartyValueProvenance,
} from "./party-enrichment";
import { directoryKeyOf } from "./subject-directory";
import { PARTY_ENRICHMENT_PIPELINE_VERSION } from "./extraction-pipeline";
import { deriveVat, type VatProvenance } from "./vat-derivation";
import type { PartySwapField } from "./party-swap";

export type EditableDocumentFields = {
  supplierName: string;
  ico: string;
  dic: string;
  icDph: string;
  customerName: string;
  customerIco: string;
  customerDic: string;
  customerIcDph: string;
  documentNumber: string;
  variableSymbol: string;
  issueDateRaw: string;
  issueDateAt: string | null;
  taxableSupplyDateRaw: string;
  taxableSupplyDateAt: string | null;
  dueDateRaw: string;
  dueDateAt: string | null;
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

export type FieldProvenance =
  | "confirmed"
  | "extracted"
  | "profile"
  | "derived"
  | "register"
  | "directory"
  | "empty";

export type FieldCheckState = "correct" | "flagged" | "empty";

export type ScalarFieldKey =
  | "supplierName"
  | "ico"
  | "dic"
  | "icDph"
  | "customerName"
  | "customerIco"
  | "customerDic"
  | "customerIcDph"
  | "documentNumber"
  | "variableSymbol"
  | "issueDateRaw"
  | "taxableSupplyDateRaw"
  | "dueDateRaw"
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
  rolesFlagged: boolean;
  missingProfile: boolean;
  vatWarnings: string[];
  /** The invoice is settled by an advance: its amount is the supply, its VAT is never inferred. */
  advanceSettled: boolean;
  /** The settlement in effect — detected, or hers over it. Null when the invoice is not settled. */
  advanceSettlement: AdvanceSettlementPayload | null;
};

export type MergeDocumentFieldsOptions = {
  folderSlot?: string;
  profile?: ClientIdentity | null;
  homeCurrency?: HomeCurrency;
  /** Results from older extraction contracts must remain byte-for-byte stable. */
  extractionPipelineVersion?: number | null;
  /** The shared subject directory's facts by subject key, read by the page or the worker, never a register (ADR 0022). */
  directory?: DirectoryFactsByKey | null;
};

export type ExportSectionFormValue = "" | "T01" | "T00";

export type DocumentFieldFormInput = {
  exportSection: ExportSectionFormValue;
  supplierName: string;
  ico: string;
  dic: string;
  icDph: string;
  customerName: string;
  customerIco: string;
  customerDic: string;
  customerIcDph: string;
  documentNumber: string;
  variableSymbol: string;
  issueDateRaw: string;
  taxableSupplyDateRaw: string;
  dueDateRaw: string;
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

function calendarIsoToSkRaw(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) {
    return "";
  }
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function calendarIsoToUtc(iso: string | null | undefined): string | null {
  const raw = calendarIsoToSkRaw(iso);
  if (!raw) {
    return null;
  }
  const parsed = parseReceiptDatetimeRaw(`${raw} 00:00:00`);
  if ("ok" in parsed) {
    return null;
  }
  return bratislavaLocalToUtcIso(parsed);
}

function ekasaDateOnly(raw: string | null): string {
  if (!raw) {
    return "";
  }
  const trimmed = raw.trim();
  const dateMatch = /^(\d{2}\.\d{2}\.\d{4})/.exec(trimmed);
  if (dateMatch) {
    return dateMatch[1]!;
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function extractedFromEkasa(extracted: EkasaExtractedPayload): Partial<EditableDocumentFields> {
  const receiptRaw = extracted.receiptTimestampRaw ?? "";
  const issueRaw = ekasaDateOnly(receiptRaw);
  return {
    supplierName: extracted.supplierName ?? "",
    ico: extracted.ico ?? "",
    dic: extracted.dic ?? "",
    icDph: extracted.icDph ?? "",
    receiptNumber: extracted.receiptNumber ?? "",
    documentNumber: extracted.receiptNumber ?? "",
    receiptTimestampRaw: receiptRaw,
    issueDateRaw: issueRaw,
    issueDateAt: extracted.receiptAt,
    taxableSupplyDateRaw: issueRaw,
    taxableSupplyDateAt: extracted.receiptAt,
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

function extractedFromModel(extracted: ExtractedPayload): Partial<EditableDocumentFields> {
  if (!isModelExtractedPayload(extracted)) {
    return {};
  }
  return {
    documentNumber: extracted.documentNumber ?? "",
    variableSymbol: extracted.variableSymbol ?? "",
    issueDateRaw: calendarIsoToSkRaw(extracted.issueDate),
    issueDateAt: calendarIsoToUtc(extracted.issueDate),
    taxableSupplyDateRaw: calendarIsoToSkRaw(extracted.taxableSupplyDate),
    taxableSupplyDateAt: calendarIsoToUtc(extracted.taxableSupplyDate),
    dueDateRaw: calendarIsoToSkRaw(extracted.dueDate),
    dueDateAt: calendarIsoToUtc(extracted.dueDate),
    currency: extracted.currency ?? "",
    amountLiteral: extracted.amountLiteral ?? "",
    amountCents: extracted.amountCents,
    vatRecap: extracted.vatRecap ?? [],
  };
}

function extractedEditableFields(
  extracted: ExtractedPayload,
): Partial<EditableDocumentFields> {
  if (isEkasaPayload(extracted)) {
    return extractedFromEkasa(extracted);
  }
  return extractedFromModel(extracted);
}

function hasConfirmedKey(confirmed: ConfirmedPayload, key: keyof ConfirmedPayload): boolean {
  return Object.prototype.hasOwnProperty.call(confirmed, key);
}

function hasDerivedField(confirmed: ConfirmedPayload, key: string): boolean {
  return Boolean(confirmed.derived?.[key]);
}

/**
 * Party enrichment and derivation apply to extraction contracts from the
 * version that introduced them; older results keep their stored behaviour.
 */
export function enrichmentEnabledFor(extractionPipelineVersion: number | null | undefined): boolean {
  return (
    extractionPipelineVersion === undefined ||
    (extractionPipelineVersion !== null &&
      extractionPipelineVersion >= PARTY_ENRICHMENT_PIPELINE_VERSION)
  );
}

function derivationEnabled(options?: MergeDocumentFieldsOptions): boolean {
  return enrichmentEnabledFor(options?.extractionPipelineVersion);
}

function dependencyValue(
  dependency: string,
  extracted: ExtractedPayload,
  confirmed: ConfirmedPayload,
  options?: MergeDocumentFieldsOptions,
): string {
  if (dependency === "folderSlot") {
    return options?.folderSlot ?? "";
  }
  if (dependency === "profileCountry") {
    return options?.profile?.country ?? "";
  }
  if (dependency === "vatRecap") {
    const rows = hasConfirmedKey(confirmed, "vatRecap")
      ? confirmed.vatRecap ?? []
      : extractedEditableFields(extracted).vatRecap ?? [];
    return JSON.stringify(rows);
  }
  const extractedFields = extractedEditableFields(extracted);
  const fieldKey = dependency === "supplierIcDph" ? "icDph" : dependency;
  const confirmedKey = fieldKey as keyof ConfirmedPayload;
  let value = hasConfirmedKey(confirmed, confirmedKey)
    ? confirmed[confirmedKey]
    : extractedFields[fieldKey as keyof EditableDocumentFields];
  if (
    dependency === "supplierIcDph" &&
    String(value ?? "").trim().length === 0 &&
    options?.folderSlot?.startsWith("01 ")
  ) {
    value = options.profile?.icDph ?? "";
  }
  return String(value ?? "");
}

function clearInvalidDerivedValue(confirmed: ConfirmedPayload, key: string): void {
  if (key === "variableSymbol") {
    delete confirmed.variableSymbol;
  } else if (key === "vatRecap") {
    delete confirmed.vatRecap;
  } else if (key === "recapBaseLiteral") {
    delete confirmed.recapBaseLiteral;
    delete confirmed.recapBaseCents;
  } else if (key === "recapVatLiteral") {
    delete confirmed.recapVatLiteral;
    delete confirmed.recapVatCents;
  }
}

/**
 * A saved derived value may depend on the invoice direction, VAT ID, or
 * folder. Invalidate it before merging when its persisted dependency snapshot
 * no longer matches the current document. Older metadata without snapshots is
 * retained for backwards compatibility and is refreshed on the next save.
 */
function invalidateStaleDerivedFields(
  extracted: ExtractedPayload,
  confirmed: ConfirmedPayload,
  options?: MergeDocumentFieldsOptions,
): ConfirmedPayload {
  if (!derivationEnabled(options) || !confirmed.derived) {
    return confirmed;
  }
  const next: ConfirmedPayload = {
    ...confirmed,
    derived: { ...confirmed.derived },
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, metadata] of Object.entries(next.derived ?? {})) {
      if (!metadata.dependencyValues) {
        continue;
      }
      const stale = metadata.dependencies.some(
        (dependency) =>
          metadata.dependencyValues?.[dependency] !==
          dependencyValue(dependency, extracted, next, options),
      );
      if (!stale) {
        continue;
      }
      clearInvalidDerivedValue(next, key);
      delete next.derived?.[key];
      changed = true;
    }
  }
  if (Object.keys(next.derived ?? {}).length === 0) {
    delete next.derived;
  }
  return next;
}

function scalarFromConfirmed(confirmed: ConfirmedPayload, key: keyof ConfirmedPayload): string {
  const value = confirmed[key];
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function mergeScalar(
  key: ScalarFieldKey,
  confirmedKey: keyof ConfirmedPayload,
  extracted: Partial<EditableDocumentFields>,
  confirmed: ConfirmedPayload,
): { value: string; provenance: FieldProvenance } {
  if (hasConfirmedKey(confirmed, confirmedKey)) {
    return {
      value: scalarFromConfirmed(confirmed, confirmedKey),
      provenance: hasDerivedField(confirmed, String(confirmedKey)) ? "derived" : "confirmed",
    };
  }
  const extractedValue = extracted[key as keyof EditableDocumentFields];
  if (typeof extractedValue === "string" && extractedValue.length > 0) {
    return { value: extractedValue, provenance: "extracted" };
  }
  return { value: "", provenance: "empty" };
}

/**
 * The variable symbol a document number implies: its digits, when there are
 * one to ten of them. The symbol is a number of at most ten digits, so
 * `SK-26001` gives `26001`, while a number with no digits, or eleven, gives
 * nothing. Used by the merge and by the Omega export, so a raw number such as
 * `SK-26001` is never written as a symbol.
 */
export function deriveVariableSymbol(documentNumber: string): string | null {
  const digits = documentNumber.replace(/\D/g, "");
  return digits.length >= 1 && digits.length <= 10 ? digits : null;
}

/**
 * A printed or extracted symbol is never replaced, and a typed one stays.
 * Otherwise the symbol is the document number's digits, flagged derived, so it
 * follows her edits to the number. A derived value is recomputed from the
 * current number rather than trusted as stored, so it cannot lag behind.
 */
function resolveVariableSymbol(
  merged: { value: string; provenance: FieldProvenance },
  documentNumber: string,
): { value: string; provenance: FieldProvenance } {
  const ownValue =
    merged.provenance === "extracted" ||
    (merged.provenance === "confirmed" && merged.value.length > 0);
  if (ownValue) {
    return merged;
  }
  const derived = deriveVariableSymbol(documentNumber);
  return derived === null
    ? { value: "", provenance: "empty" }
    : { value: derived, provenance: "derived" };
}

function mergeMoneyLiteral(
  literalKey: "amountLiteral" | "recapBaseLiteral" | "recapVatLiteral",
  centsKey: "amountCents" | "recapBaseCents" | "recapVatCents",
  extracted: Partial<EditableDocumentFields>,
  confirmed: ConfirmedPayload,
): { literal: string; cents: number | null; provenance: FieldProvenance } {
  if (hasConfirmedKey(confirmed, literalKey)) {
    const literal = scalarFromConfirmed(confirmed, literalKey);
    const cents = confirmed[centsKey] ?? null;
    return {
      literal,
      cents,
      provenance: hasDerivedField(confirmed, literalKey) ? "derived" : "confirmed",
    };
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

function mergeDateAt(
  atKey: "issueDateAt" | "taxableSupplyDateAt" | "dueDateAt" | "receiptAt",
  extracted: Partial<EditableDocumentFields>,
  confirmed: ConfirmedPayload,
): string | null {
  if (hasConfirmedKey(confirmed, atKey)) {
    return (confirmed[atKey] as string | null | undefined) ?? null;
  }
  return (extracted[atKey] as string | null | undefined) ?? null;
}

/**
 * Completes both parties from the profile, then judges the roles against it.
 * Shared by the server merge and the panel, which recomputes the flags from
 * the values she has just swapped.
 */
export function resolvePartyRoles(input: {
  folderSlot: string | undefined;
  profile: ClientIdentity | null;
  enabled: boolean;
  /** Whether any party value is confirmed or extracted, so roles can be judged. */
  labeled: boolean;
  supplier: PartySource;
  customer: PartySource;
  /** The directory's facts for the parties' subjects; missing values only are filled. */
  directory?: DirectoryFactsByKey | null;
}): {
  supplier: PartySource;
  customer: PartySource;
  rolesFlagged: boolean;
  missingProfile: boolean;
} {
  const completed = enrichInvoiceParties({
    folderSlot: input.folderSlot ?? "",
    supplier: input.supplier,
    customer: input.customer,
    profile: input.profile,
    enabled: input.enabled,
  });
  // The directory fill is an enrichment too: an older extraction contract keeps its stored behaviour.
  const fill = (party: PartySource) =>
    input.enabled ? fillFromDirectory(party, directoryFactsOf(input.directory, party)) : party;
  const enriched = {
    ...completed,
    supplier: fill(completed.supplier),
    customer: fill(completed.customer),
  };

  const folderSlot = input.folderSlot;
  const invoiceFolder =
    folderSlot !== undefined &&
    (folderSlot.startsWith("01 ") || folderSlot.startsWith("02 "));
  let rolesFlagged = false;
  let missingProfile = false;
  if (invoiceFolder && input.labeled) {
    const validation = validateLabeledPartyRoles({
      folderSlot,
      profile: input.profile,
      supplier: {
        name: enriched.supplier.name.value,
        ico: enriched.supplier.ico.value,
        dic: enriched.supplier.dic.value,
        icDph: enriched.supplier.icDph.value,
      },
      customer: {
        name: enriched.customer.name.value,
        ico: enriched.customer.ico.value,
        dic: enriched.customer.dic.value,
        icDph: enriched.customer.icDph.value,
      },
    });
    rolesFlagged = validation.rolesFlagged;
    missingProfile = validation.missingProfile;
  }
  rolesFlagged = rolesFlagged || enriched.conflicts.supplier || enriched.conflicts.customer;

  return {
    supplier: enriched.supplier,
    customer: enriched.customer,
    rolesFlagged,
    missingProfile,
  };
}

/** The directory's facts for the subject a party resolves to; none when the party has no subject key. */
function directoryFactsOf(
  directory: DirectoryFactsByKey | null | undefined,
  party: PartySource,
): DirectoryPartyFacts | undefined {
  if (!directory) {
    return undefined;
  }
  const key = directoryKeyOf({
    name: party.name.value,
    ico: party.ico.value,
    dic: party.dic.value,
    icDph: party.icDph.value,
  });
  return key === null ? undefined : directory[key];
}

/**
 * A party value confirmed by a swap keeps the badge of its source. Only
 * applies while the value is stored as confirmed, so extraction never gets it.
 */
function withPartyProvenance(
  key: PartySwapField,
  result: { value: string; provenance: FieldProvenance },
  confirmed: ConfirmedPayload,
): { value: string; provenance: FieldProvenance } {
  const recorded = confirmed.partyProvenance?.[key];
  if (recorded === undefined || !hasConfirmedKey(confirmed, key)) {
    return result;
  }
  return {
    value: result.value,
    provenance: result.value.length === 0 ? "empty" : recorded,
  };
}

function mergePartyFields(
  extracted: ExtractedPayload,
  confirmed: ConfirmedPayload,
  fromExtracted: Partial<EditableDocumentFields>,
  options?: MergeDocumentFieldsOptions,
): {
  supplier: ReturnType<typeof mergeScalar>;
  ico: ReturnType<typeof mergeScalar>;
  dic: ReturnType<typeof mergeScalar>;
  icDph: ReturnType<typeof mergeScalar>;
  customerName: ReturnType<typeof mergeScalar>;
  customerIco: ReturnType<typeof mergeScalar>;
  customerDic: ReturnType<typeof mergeScalar>;
  customerIcDph: ReturnType<typeof mergeScalar>;
  rolesFlagged: boolean;
  missingProfile: boolean;
} {
  const hasLabeledSupplier =
    hasConfirmedKey(confirmed, "supplierName") ||
    hasConfirmedKey(confirmed, "ico") ||
    hasConfirmedKey(confirmed, "dic") ||
    hasConfirmedKey(confirmed, "icDph");
  const hasLabeledCustomer =
    hasConfirmedKey(confirmed, "customerName") ||
    hasConfirmedKey(confirmed, "customerIco") ||
    hasConfirmedKey(confirmed, "customerDic") ||
    hasConfirmedKey(confirmed, "customerIcDph");

  let roleSeed = {
    supplierName: fromExtracted.supplierName ?? "",
    ico: fromExtracted.ico ?? "",
    dic: fromExtracted.dic ?? "",
    icDph: fromExtracted.icDph ?? "",
    customerName: fromExtracted.customerName ?? "",
    customerIco: fromExtracted.customerIco ?? "",
    customerDic: fromExtracted.customerDic ?? "",
    customerIcDph: fromExtracted.customerIcDph ?? "",
  };

  let rolesFlagged = false;
  let missingProfile = false;

  if (
    isModelExtractedPayload(extracted) &&
    !hasLabeledSupplier &&
    !hasLabeledCustomer &&
    options?.folderSlot
  ) {
    const assigned = assignPartiesFromExtracted({
      folderSlot: options.folderSlot,
      profile: options.profile ?? null,
      parties: extracted.parties,
    });
    roleSeed = {
      supplierName: assigned.supplier.name,
      ico: assigned.supplier.ico,
      dic: assigned.supplier.dic,
      icDph: assigned.supplier.icDph,
      customerName: assigned.customer.name,
      customerIco: assigned.customer.ico,
      customerDic: assigned.customer.dic,
      customerIcDph: assigned.customer.icDph,
    };
    rolesFlagged = assigned.rolesFlagged;
    missingProfile = assigned.missingProfile;
    fromExtracted = { ...fromExtracted, ...roleSeed };
  }

  const partyScalar = (key: PartySwapField) =>
    withPartyProvenance(key, mergeScalar(key, key, fromExtracted, confirmed), confirmed);
  const supplier = partyScalar("supplierName");
  const ico = partyScalar("ico");
  const dic = partyScalar("dic");
  const icDph = partyScalar("icDph");
  const customerName = partyScalar("customerName");
  const customerIco = partyScalar("customerIco");
  const customerDic = partyScalar("customerDic");
  const customerIcDph = partyScalar("customerIcDph");

  // An emptied field keeps `confirmed` while the enrichment reads it, so that the
  // directory does not refill what she cleared; it shows as empty, as it always has.
  const partySource = (values: Record<PartyField, ReturnType<typeof mergeScalar>>) => {
    const source = partySourceFromValues(
      Object.fromEntries(
        (Object.keys(values) as PartyField[]).map((field) => [field, values[field].value]),
      ),
      "extracted",
    );
    for (const field of Object.keys(values) as PartyField[]) {
      const provenance = values[field].provenance as PartyValueProvenance;
      if (source[field].value || provenance === "confirmed") {
        source[field].provenance = provenance;
      }
    }
    return source;
  };
  const visible = (field: ReturnType<typeof mergeScalar>) =>
    field.value.length === 0 && field.provenance === "confirmed"
      ? { value: "", provenance: "empty" as const }
      : field;

  const resolved = resolvePartyRoles({
    folderSlot: options?.folderSlot,
    profile: options?.profile ?? null,
    enabled: derivationEnabled(options),
    labeled: hasLabeledSupplier || hasLabeledCustomer || supplier.provenance !== "empty",
    supplier: partySource({ name: supplier, ico, dic, icDph }),
    customer: partySource({ name: customerName, ico: customerIco, dic: customerDic, icDph: customerIcDph }),
    directory: options?.directory ?? null,
  });
  rolesFlagged = rolesFlagged || resolved.rolesFlagged;
  missingProfile = missingProfile || resolved.missingProfile;
  const enriched = resolved;

  return {
    supplier: visible(enriched.supplier.name),
    ico: visible(enriched.supplier.ico),
    dic: visible(enriched.supplier.dic),
    icDph: visible(enriched.supplier.icDph),
    customerName: visible(enriched.customer.name),
    customerIco: visible(enriched.customer.ico),
    customerDic: visible(enriched.customer.dic),
    customerIcDph: visible(enriched.customer.icDph),
    rolesFlagged,
    missingProfile,
  };
}

export function mergeDocumentFields(
  extractedAsRead: ExtractedPayload,
  confirmed: ConfirmedPayload,
  options?: MergeDocumentFieldsOptions,
): MergedDocumentFields {
  // Her settled / not-settled decision applies to what was read, before anything reads it.
  const extracted = isModelExtractedPayload(extractedAsRead)
    ? applyAdvanceOverride(extractedAsRead, confirmed.advanceSettlement?.settled)
    : extractedAsRead;
  let fromExtracted = extractedEditableFields(extracted);
  confirmed = invalidateStaleDerivedFields(extracted, confirmed, options);

  const parties = mergePartyFields(extracted, confirmed, fromExtracted, options);

  const documentNumber = mergeScalar(
    "documentNumber",
    "documentNumber",
    fromExtracted,
    confirmed,
  );
  const issueDateRaw = mergeScalar("issueDateRaw", "issueDateRaw", fromExtracted, confirmed);
  const taxableSupplyDateRaw = mergeScalar(
    "taxableSupplyDateRaw",
    "taxableSupplyDateRaw",
    fromExtracted,
    confirmed,
  );
  const dueDateRaw = mergeScalar("dueDateRaw", "dueDateRaw", fromExtracted, confirmed);
  const receiptNumber = mergeScalar("receiptNumber", "receiptNumber", fromExtracted, confirmed);
  // The symbol follows the number the document shows, which a receipt carries as its receipt number.
  const variableSymbol = resolveVariableSymbol(
    mergeScalar("variableSymbol", "variableSymbol", fromExtracted, confirmed),
    documentNumber.value || receiptNumber.value,
  );
  const receiptTimestampRaw = mergeScalar(
    "receiptTimestampRaw",
    "receiptTimestampRaw",
    fromExtracted,
    confirmed,
  );
  const currency = mergeScalar("currency", "currency", fromExtracted, confirmed);
  const settlement = isModelExtractedPayload(extracted) ? extracted.advanceSettlement : undefined;
  let amount = mergeMoneyLiteral("amountLiteral", "amountCents", fromExtracted, confirmed);
  if (settlement?.totalProvenance === "derived" && amount.provenance === "extracted") {
    // The supply total was summed from its rows, not printed: shown as calculated.
    amount = { ...amount, provenance: "derived" };
  }
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
  if (hasConfirmedKey(confirmed, "vatRecap")) {
    vatRecap = confirmed.vatRecap ?? [];
    vatRecapProvenance = hasDerivedField(confirmed, "vatRecap") ? "derived" : "confirmed";
  } else if ((fromExtracted.vatRecap?.length ?? 0) > 0) {
    vatRecap = fromExtracted.vatRecap!;
    vatRecapProvenance = "extracted";
  } else {
    vatRecap = [];
    vatRecapProvenance = "empty";
  }

  const homeCurrency =
    options?.homeCurrency ??
    (options?.profile?.country != null
      ? homeCurrencyForCountry(options.profile.country)
      : "EUR");
  const effectiveCurrency = currency.value || homeCurrency;

  const effectiveDocumentNumber =
    documentNumber.value || receiptNumber.value;

  const vat = deriveVat({
    amount: {
      literal: amount.literal,
      cents: amount.cents,
      provenance: amount.provenance as VatProvenance,
    },
    recapBase: {
      literal: recapBase.literal,
      cents: recapBase.cents,
      provenance: recapBase.provenance as VatProvenance,
    },
    recapVat: {
      literal: recapVat.literal,
      cents: recapVat.cents,
      provenance: recapVat.provenance as VatProvenance,
    },
    vatRecap,
    vatRecapProvenance: vatRecapProvenance as VatProvenance,
    folderSlot: options?.folderSlot ?? "",
    supplierIcDph: parties.icDph.value,
    profileCountry: options?.profile?.country ?? null,
    advanceSettled: settlement !== undefined,
    enabled:
      options?.extractionPipelineVersion === undefined ||
      (options.extractionPipelineVersion !== null &&
        options.extractionPipelineVersion >= PARTY_ENRICHMENT_PIPELINE_VERSION),
  });

  return {
    fields: {
      supplierName: parties.supplier.value,
      ico: parties.ico.value,
      dic: parties.dic.value,
      icDph: parties.icDph.value,
      customerName: parties.customerName.value,
      customerIco: parties.customerIco.value,
      customerDic: parties.customerDic.value,
      customerIcDph: parties.customerIcDph.value,
      documentNumber: effectiveDocumentNumber,
      variableSymbol: variableSymbol.value,
      issueDateRaw: issueDateRaw.value,
      issueDateAt: mergeDateAt("issueDateAt", fromExtracted, confirmed),
      taxableSupplyDateRaw: taxableSupplyDateRaw.value,
      taxableSupplyDateAt: mergeDateAt("taxableSupplyDateAt", fromExtracted, confirmed),
      dueDateRaw: dueDateRaw.value,
      dueDateAt: mergeDateAt("dueDateAt", fromExtracted, confirmed),
      receiptNumber: receiptNumber.value || effectiveDocumentNumber,
      receiptTimestampRaw: receiptTimestampRaw.value,
      receiptAt: mergeDateAt("receiptAt", fromExtracted, confirmed),
      currency: effectiveCurrency,
      amountLiteral: amount.literal,
      amountCents: amount.cents,
      recapBaseLiteral: vat.recapBase.literal,
      recapBaseCents: vat.recapBase.cents,
      recapVatLiteral: vat.recapVat.literal,
      recapVatCents: vat.recapVat.cents,
      vatRecap: vat.vatRecap,
    },
    provenance: {
      supplierName: parties.supplier.provenance,
      ico: parties.ico.provenance,
      dic: parties.dic.provenance,
      icDph: parties.icDph.provenance,
      customerName: parties.customerName.provenance,
      customerIco: parties.customerIco.provenance,
      customerDic: parties.customerDic.provenance,
      customerIcDph: parties.customerIcDph.provenance,
      documentNumber: documentNumber.provenance,
      variableSymbol: variableSymbol.provenance,
      issueDateRaw: issueDateRaw.provenance,
      taxableSupplyDateRaw: taxableSupplyDateRaw.provenance,
      dueDateRaw: dueDateRaw.provenance,
      receiptNumber: receiptNumber.provenance,
      receiptTimestampRaw: receiptTimestampRaw.provenance,
      currency: currency.provenance,
      amountLiteral: amount.provenance,
      recapBaseLiteral: vat.recapBase.provenance,
      recapVatLiteral: vat.recapVat.provenance,
      vatRecap: vat.vatRecapProvenance,
    },
    nonEurCurrency:
      effectiveCurrency.length > 0 && effectiveCurrency !== homeCurrency,
    rolesFlagged: parties.rolesFlagged,
    missingProfile: parties.missingProfile,
    vatWarnings: vat.warnings,
    advanceSettled: settlement !== undefined,
    advanceSettlement: settlement ?? null,
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

function parseOptionalDateField(
  raw: string | undefined,
): { raw: string; at: string | null } | { ok: false; reason: string } {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return { raw: "", at: null };
  }
  const withTime = /^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)
    ? `${trimmed} 00:00:00`
    : trimmed;
  const timestamp = parseReceiptDatetimeRaw(withTime);
  if ("ok" in timestamp) {
    return {
      ok: false,
      reason: "Dátum musí byť v tvare DD.MM.RRRR, prípadne s časom HH:MM:SS.",
    };
  }
  return { raw: trimmed, at: bratislavaLocalToUtcIso(timestamp) };
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
      return { ok: false, reason: "Každý riadok DPH potrebuje sadzbu." };
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
    const parsedReceipt = parseOptionalDateField(receiptTimestampRaw);
    if ("ok" in parsedReceipt) {
      return parsedReceipt;
    }
    receiptAt = parsedReceipt.at;
  }

  const issueDate = parseOptionalDateField(input.issueDateRaw);
  if ("ok" in issueDate) {
    return issueDate;
  }
  const taxableSupplyDate = parseOptionalDateField(input.taxableSupplyDateRaw);
  if ("ok" in taxableSupplyDate) {
    return taxableSupplyDate;
  }
  const dueDate = parseOptionalDateField(input.dueDateRaw);
  if ("ok" in dueDate) {
    return dueDate;
  }

  const documentNumber = input.documentNumber.trim() || input.receiptNumber.trim();

  const exportSectionRaw = input.exportSection.trim();
  const exportSection: ConfirmedPayload["exportSection"] =
    exportSectionRaw === "T01" || exportSectionRaw === "T00"
      ? exportSectionRaw
      : null;

  const payload: ConfirmedPayload = {
    exportSection,
    supplierName: input.supplierName.trim() || null,
    ico: input.ico.trim() || null,
    dic: input.dic.trim() || null,
    icDph: input.icDph.trim() || null,
    customerName: input.customerName.trim() || null,
    customerIco: input.customerIco.trim() || null,
    customerDic: input.customerDic.trim() || null,
    customerIcDph: input.customerIcDph.trim() || null,
    documentNumber: documentNumber || null,
    variableSymbol: input.variableSymbol.trim() || null,
    issueDateRaw: issueDate.raw || null,
    issueDateAt: issueDate.at,
    taxableSupplyDateRaw: taxableSupplyDate.raw || null,
    taxableSupplyDateAt: taxableSupplyDate.at,
    dueDateRaw: dueDate.raw || null,
    dueDateAt: dueDate.at,
    receiptNumber: documentNumber || null,
    receiptTimestampRaw: receiptTimestampRaw || issueDate.raw || null,
    receiptAt: receiptAt ?? issueDate.at,
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

export function fieldCheckState(
  provenance: FieldProvenance,
  flagged: boolean,
): FieldCheckState {
  if (provenance === "empty") {
    return "empty";
  }
  if (flagged) {
    return "flagged";
  }
  return "correct";
}

/** The total base + VAT is exactly the total, or its legal cash rounding. */
function isLegalPayable(recapTotalCents: number, fields: EditableDocumentFields): boolean {
  if (fields.amountCents === null) {
    return true;
  }
  return (
    cashRoundingCents({
      itemsTotalCents: recapTotalCents,
      payableCents: fields.amountCents,
      currency: fields.currency,
    }) !== null
  );
}

function recapTotalOfFields(fields: EditableDocumentFields): number | null {
  const rows = fields.vatRecap.filter(
    (row) => row.baseLiteral.trim().length > 0 || row.vatLiteral.trim().length > 0,
  );
  if (rows.length > 0) {
    return rows.reduce((sum, row) => sum + row.baseCents + row.vatCents, 0);
  }
  if (fields.recapBaseCents === null || fields.recapVatCents === null) {
    return null;
  }
  return fields.recapBaseCents + fields.recapVatCents;
}

/**
 * The cash rounding between base + VAT and the total, when it is non-zero and
 * exactly what the law prescribes for the document's currency (see
 * cash-rounding.ts). Derived rather than stored, so it follows her edits.
 */
export function cashRoundingOfFields(fields: EditableDocumentFields): number | null {
  if (fields.amountCents === null) {
    return null;
  }
  const recapTotal = recapTotalOfFields(fields);
  if (recapTotal === null) {
    return null;
  }
  const rounding = cashRoundingCents({
    itemsTotalCents: recapTotal,
    payableCents: fields.amountCents,
    currency: fields.currency,
  });
  return rounding === null || rounding === 0 ? null : rounding;
}

export function checkArithmeticWarning(
  fields: EditableDocumentFields,
): string | null {
  const warnings = checkArithmeticWarnings(fields);
  return warnings[0] ?? null;
}

export function checkArithmeticWarnings(
  fields: EditableDocumentFields,
): string[] {
  if (fields.amountCents === null) {
    return [];
  }

  const warnings: string[] = [];

  if (fields.vatRecap.length > 0) {
    let baseSum = 0;
    let vatSum = 0;
    let rowsWithAmounts = 0;
    for (const row of fields.vatRecap) {
      if (row.baseLiteral.trim().length === 0 && row.vatLiteral.trim().length === 0) {
        continue;
      }
      rowsWithAmounts += 1;
      baseSum += row.baseCents;
      vatSum += row.vatCents;
    }
    if (rowsWithAmounts === 0) {
      return [];
    }
    const sum = baseSum + vatSum;
    if (!isLegalPayable(sum, fields)) {
      const sumLiteral = (sum / 100).toFixed(2);
      warnings.push(
        `Súčet základov DPH (${(baseSum / 100).toFixed(2)}) a DPH (${(vatSum / 100).toFixed(2)}) je ${sumLiteral}, ale celková suma je ${fields.amountLiteral}.`,
      );
      for (const row of fields.vatRecap) {
        if (row.baseLiteral.trim().length === 0 && row.vatLiteral.trim().length === 0) {
          continue;
        }
        const rowSum = row.baseCents + row.vatCents;
        const rowSumLiteral = (rowSum / 100).toFixed(2);
        warnings.push(
          `Sadzba ${row.rateLiteral} %: základ ${row.baseLiteral} plus DPH ${row.vatLiteral} je ${rowSumLiteral}.`,
        );
      }
    }
    return warnings;
  }

  if (fields.recapBaseCents === null || fields.recapVatCents === null) {
    return [];
  }
  const sum = fields.recapBaseCents + fields.recapVatCents;
  if (isLegalPayable(sum, fields)) {
    return [];
  }
  const sumLiteral = (sum / 100).toFixed(2);
  return [
    `Základ DPH (${fields.recapBaseLiteral}) plus DPH (${fields.recapVatLiteral}) je ${sumLiteral}, ale celková suma je ${fields.amountLiteral}.`,
  ];
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
