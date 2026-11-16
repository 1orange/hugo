import { appendUserEvent } from "@/adapters/store/events";
import {
  getDocument,
  setDocumentDecision,
  updateDocumentNote,
  writeConfirmedPayload,
  type DocumentRow,
} from "@/adapters/store/documents";
import { getCompanyProfile } from "@/adapters/store/company-profiles";
import {
  isModelExtractedPayload,
  parseConfirmedPayload,
  parseExtractedPayload,
  type ConfirmedPayload,
  type DocumentVatRecapRow,
  type ExtractedPayload,
} from "@/modules/document-payload";
import {
  PARTY_SWAP_FIELDS,
  pickPartyProvenance,
  type PartySwapField,
  type PartySwapProvenance,
  type PartySwapValues,
} from "@/modules/party-swap";
import {
  readExportSectionOverride,
  type ExportSectionOverride,
} from "@/modules/omega-export-section";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import {
  queueSubjectCheckForDocument,
  scheduleSubjectCheckForDocument,
} from "@/lib/subject-directory/schedule";
import {
  mergedPartyFieldsOf,
  partyIdentityOf,
} from "@/lib/subject-directory/verify-document";
import {
  parseConfirmedFieldsFromInput,
  mergeDocumentFields,
  type DocumentFieldFormInput,
  type EditableDocumentFields,
  type MergedDocumentFields,
  type MergeDocumentFieldsOptions,
} from "@/modules/document-fields";
import type { PartyIdentity } from "@/modules/party-roles";
import type { PartyValueProvenance } from "@/modules/party-enrichment";
import {
  clientIdentityOf,
  offersRegisterTakeover,
  parsePartyIntegrityRecord,
  partyIdentityKey,
} from "@/modules/subject-integrity";
import { resolveSubject } from "@/lib/subject-directory/service";
import { mergeDocumentFieldsWithDirectory } from "@/lib/subject-directory/directory-facts";

export type DocumentActionResult =
  | { ok: true }
  | { ok: false; message: string };

const DERIVED_DEPENDENCIES: Record<string, string[]> = {
  recapBaseLiteral: ["vatRecap"],
  recapVatLiteral: ["vatRecap"],
  vatRecap: [
    "amountLiteral",
    "recapBaseLiteral",
    "supplierIcDph",
    "profileCountry",
    "folderSlot",
  ],
};

function dependenciesFor(
  key: string,
  merged: ReturnType<typeof mergeDocumentFields>,
): string[] {
  if (key === "recapVatLiteral" && merged.provenance.vatRecap === "derived") {
    return [
      "amountLiteral",
      "recapBaseLiteral",
      "supplierIcDph",
      "profileCountry",
      "folderSlot",
    ];
  }
  return DERIVED_DEPENDENCIES[key] ?? [];
}

function dependencyValuesFor(
  key: string,
  merged: ReturnType<typeof mergeDocumentFields>,
  folderSlot: string,
  profileCountry: string,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const dependency of dependenciesFor(key, merged)) {
    values[dependency] =
      dependency === "vatRecap"
        ? JSON.stringify(merged.fields.vatRecap)
        : dependency === "folderSlot"
          ? folderSlot
          : dependency === "supplierIcDph"
            ? merged.fields.icDph
            : dependency === "profileCountry"
              ? profileCountry
            : merged.fields[
                dependency as "amountLiteral" | "recapBaseLiteral" | "recapVatLiteral"
              ];
  }
  return values;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function derivedFieldChanged(
  key: string,
  before: ReturnType<typeof mergeDocumentFields>["fields"],
  next: ConfirmedPayload,
): boolean {
  if (key === "recapBaseLiteral") {
    return String(next.recapBaseLiteral ?? "") !== before.recapBaseLiteral;
  }
  if (key === "recapVatLiteral") {
    return String(next.recapVatLiteral ?? "") !== before.recapVatLiteral;
  }
  if (key === "vatRecap") {
    return !equalJson(next.vatRecap ?? [], before.vatRecap);
  }
  return false;
}

function clearDerivedField(payload: ConfirmedPayload, key: string): void {
  if (key === "recapBaseLiteral") {
    payload.recapBaseLiteral = null;
    payload.recapBaseCents = null;
  } else if (key === "recapVatLiteral") {
    payload.recapVatLiteral = null;
    payload.recapVatCents = null;
  } else if (key === "vatRecap") {
    payload.vatRecap = [];
  }
}

function copyDerivedEffectiveValue(
  payload: ConfirmedPayload,
  key: string,
  merged: ReturnType<typeof mergeDocumentFields>,
): void {
  if (key === "recapBaseLiteral") {
    payload.recapBaseLiteral = merged.fields.recapBaseLiteral || null;
    payload.recapBaseCents = merged.fields.recapBaseCents;
  } else if (key === "recapVatLiteral") {
    payload.recapVatLiteral = merged.fields.recapVatLiteral || null;
    payload.recapVatCents = merged.fields.recapVatCents;
  } else if (key === "vatRecap") {
    payload.vatRecap = merged.fields.vatRecap;
  }
}

export async function confirmDocument(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  confirmed: boolean;
  now?: string;
}): Promise<DocumentActionResult> {
  const readOnly = await assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = await getDocument(input.documentId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }

  const now = input.now ?? new Date().toISOString();
  if (input.confirmed) {
    await setDocumentDecision(input.documentId, "confirmed", {
      decidedAt: now,
      notRelevantReason: null,
    });
    await appendUserEvent(now, input.companyId, "Confirmed", {
      monthKey: input.monthKey,
      driveFileId: document.driveFileId,
      documentId: document.id,
    });
    // A confirmed document may record its subject's VAT-group membership (PRD 0004, story 33).
    await scheduleSubjectCheckForDocument(document.id);
  } else {
    await setDocumentDecision(input.documentId, null, {
      decidedAt: null,
      notRelevantReason: null,
    });
  }

  return { ok: true };
}

export async function dismissDocument(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  reason?: string;
  now?: string;
}): Promise<DocumentActionResult> {
  const readOnly = await assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = await getDocument(input.documentId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }

  const now = input.now ?? new Date().toISOString();
  await setDocumentDecision(input.documentId, "not_relevant", {
    decidedAt: now,
    notRelevantReason: input.reason?.trim() || null,
  });

  return { ok: true };
}

export async function saveDocumentNote(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  note: string;
}): Promise<DocumentActionResult> {
  const readOnly = await assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = await getDocument(input.documentId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }

  await updateDocumentNote(input.documentId, input.note.trim() || null);
  return { ok: true };
}

type LoadedDocument = { ok: true; document: DocumentRow } | { ok: false; message: string };

async function loadEditableDocument(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
}): Promise<LoadedDocument> {
  const readOnly = await assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = await getDocument(input.documentId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }
  return { ok: true, document };
}

export async function saveDocumentFields(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  fields: DocumentFieldFormInput;
}): Promise<DocumentActionResult> {
  const loaded = await loadEditableDocument(input);
  if (!loaded.ok) {
    return loaded;
  }
  return writeDocumentFields({ ...input, document: loaded.document, partyProvenance: null });
}

/**
 * Swaps *Dodávateľ* and *Odberateľ* as her correction: the swapped values are
 * saved through the same path as any edit, with the provenance they carry.
 * Allowed on a decided document too, as its fields are: a misread party is
 * mended after the decision (2026-11-12). Refused once it is exported.
 */
export async function swapDocumentParties(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  fields: DocumentFieldFormInput;
  partyProvenance: PartySwapProvenance;
  now?: string;
}): Promise<DocumentActionResult> {
  const loaded = await loadEditableDocument(input);
  if (!loaded.ok) {
    return loaded;
  }
  const { document } = loaded;
  if (document.exportedAt !== null) {
    return { ok: false, message: "Doklad je už exportovaný do Omegy, strany sa nedajú vymeniť." };
  }
  if (!isPartySwapProvenance(input.partyProvenance)) {
    return { ok: false, message: "Neplatný stav strán dokladu." };
  }

  const written = await writeDocumentFields({
    ...input,
    document,
    partyProvenance: input.partyProvenance,
  });
  if (!written.ok) {
    return written;
  }

  await appendUserEvent(input.now ?? new Date().toISOString(), input.companyId, "PartiesSwapped", {
    monthKey: input.monthKey,
    driveFileId: document.driveFileId,
    documentId: document.id,
  });
  return { ok: true };
}

const PARTY_PROVENANCE_VALUES = new Set<PartyValueProvenance>([
  "empty",
  "extracted",
  "confirmed",
  "profile",
  "derived",
  "register",
  "directory",
]);

function isPartySwapProvenance(value: unknown): value is PartySwapProvenance {
  if (!value || typeof value !== "object") {
    return false;
  }
  return PARTY_SWAP_FIELDS.every((field) =>
    PARTY_PROVENANCE_VALUES.has((value as Record<string, unknown>)[field] as PartyValueProvenance),
  );
}

/** The amounts a settlement decides: the total and the VAT recap totals. */
const SETTLEMENT_AMOUNT_GROUPS = [
  { literal: "amountLiteral", cents: "amountCents" },
  { literal: "recapBaseLiteral", cents: "recapBaseCents" },
  { literal: "recapVatLiteral", cents: "recapVatCents" },
] as const;

function sameVatRows(left: readonly DocumentVatRecapRow[], right: readonly DocumentVatRecapRow[]): boolean {
  const shape = (rows: readonly DocumentVatRecapRow[]) =>
    rows.map((row) => [row.rateLiteral, row.baseLiteral, row.baseCents, row.vatLiteral, row.vatCents]);
  return JSON.stringify(shape(left)) === JSON.stringify(shape(right));
}

/**
 * Drops the stored amounts that the extraction itself produced, in either
 * state of the settlement: the panel saves every amount it shows, so without
 * this a saved supply total would outlive her decision. Amounts she typed are
 * different from both and stay hers.
 */
function withoutExtractionAmounts(
  confirmed: ConfirmedPayload,
  extracted: ExtractedPayload,
  options: MergeDocumentFieldsOptions,
): ConfirmedPayload {
  const asRead = [false, true].map(
    (settled) =>
      mergeDocumentFields(extracted, { advanceSettlement: { settled, source: "manual" } }, options).fields,
  );
  const next: ConfirmedPayload = { ...confirmed };
  const derived = { ...(next.derived ?? {}) };
  const dropKeys = (keys: string[]) => {
    for (const key of keys) {
      delete (next as Record<string, unknown>)[key];
      delete derived[key];
    }
  };
  for (const group of SETTLEMENT_AMOUNT_GROUPS) {
    if (!Object.prototype.hasOwnProperty.call(confirmed, group.literal)) {
      continue;
    }
    const literal = String(confirmed[group.literal] ?? "");
    const cents = confirmed[group.cents] ?? null;
    const extractedHere = asRead.some(
      (fields) =>
        fields[group.literal] === literal && (fields[group.cents] ?? null) === cents,
    );
    if (extractedHere) {
      dropKeys([group.literal, group.cents]);
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(confirmed, "vatRecap") &&
    asRead.some((fields) => sameVatRows(fields.vatRecap, confirmed.vatRecap ?? []))
  ) {
    dropKeys(["vatRecap"]);
  }
  next.derived = derived;
  if (Object.keys(derived).length === 0) {
    delete next.derived;
  }
  return next;
}

/**
 * Her decision whether the invoice is settled by an advance (PRD 0004 issue
 * 11, ADR 0010). It is stored as a flag over the detection, so a re-read keeps
 * it, and the amounts follow it. Allowed on a decided document, refused once
 * it is exported, as a swap is.
 */
export async function setAdvanceSettlement(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  settled: boolean;
  now?: string;
}): Promise<DocumentActionResult> {
  const loaded = await loadEditableDocument(input);
  if (!loaded.ok) {
    return loaded;
  }
  const { document } = loaded;
  if (document.exportedAt !== null) {
    return { ok: false, message: "Doklad je už exportovaný do Omegy, vyúčtovanie zálohy sa nedá zmeniť." };
  }
  const extracted = parseExtractedPayload(document.extractedPayloadJson);
  if (!isModelExtractedPayload(extracted)) {
    return { ok: false, message: "Doklad nemá prečítané údaje, vyúčtovanie zálohy sa nedá označiť." };
  }

  const previousConfirmed = parseConfirmedPayload(document.confirmedPayloadJson);
  const profile = await getCompanyProfile(input.companyId);
  const options: MergeDocumentFieldsOptions = {
    folderSlot: document.folderSlot,
    profile,
    extractionPipelineVersion: document.extractionPipelineVersion,
  };
  const next: ConfirmedPayload = {
    ...withoutExtractionAmounts(previousConfirmed, extracted, options),
    advanceSettlement: { settled: input.settled, source: "manual" },
  };
  if (input.settled && !mergeDocumentFields(extracted, next, options).advanceSettled) {
    return { ok: false, message: "V doklade sa nedá nájsť odpočet zálohy — údaje doplň ručne." };
  }

  await writeConfirmedPayload(document.id, next);
  if (previousConfirmed.advanceSettlement?.settled !== input.settled) {
    await appendUserEvent(
      input.now ?? new Date().toISOString(),
      input.companyId,
      "AdvanceSettlementOverridden",
      {
        monthKey: input.monthKey,
        driveFileId: document.driveFileId,
        documentId: document.id,
        settled: input.settled,
      },
    );
  }
  return { ok: true };
}

/**
 * Party badges after a write. A swap records its own provenance. An ordinary
 * edit keeps the recorded badge of every party value it left as it was; the
 * edited ones become hers, as every confirmed value does. A value taken from
 * the register carries `register`. A value the directory filled and she did
 * not touch is not stored at all (see writeDocumentFields), so it has no badge here.
 */
function nextPartyProvenance(input: {
  swapped: PartySwapProvenance | null;
  previousConfirmed: ConfirmedPayload;
  previousShown: MergedDocumentFields;
  payload: ConfirmedPayload;
  taken: readonly PartySwapField[];
  dropped: ReadonlySet<PartySwapField>;
}): ConfirmedPayload["partyProvenance"] {
  const next: NonNullable<ConfirmedPayload["partyProvenance"]> = {};
  if (input.swapped) {
    Object.assign(next, pickPartyProvenance(input.swapped));
  } else if (input.previousConfirmed.partyProvenance || input.taken.length > 0) {
    // A take is not a retyping of the other values: their badges stay as they were.
    for (const field of PARTY_SWAP_FIELDS) {
      if ((input.payload[field] ?? "") === input.previousShown.fields[field]) {
        next[field] = input.previousShown.provenance[field];
      }
    }
  }
  for (const field of input.taken) {
    next[field] = "register";
  }
  for (const field of input.dropped) {
    delete next[field];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The party values that are not stored, so that they stay what the directory
 * (or nothing) says: a value the directory filled and she did not change, and a
 * value that was empty and is still empty, which is not an emptying of hers. A
 * swap moves a value with its IČO, so a directory value is derived on the other
 * side too (ADR 0022).
 */
function unstoredPartyFields(input: {
  swapped: PartySwapProvenance | null;
  previousShown: MergedDocumentFields;
  payload: ConfirmedPayload;
  taken: readonly PartySwapField[];
}): Set<PartySwapField> {
  const unstored = new Set<PartySwapField>();
  for (const field of PARTY_SWAP_FIELDS) {
    if (input.taken.includes(field)) {
      continue;
    }
    if (input.swapped) {
      // A value that moved as a directory fill, or as nothing, is not hers to store.
      const moved = input.swapped[field];
      if (moved === "directory" || (moved === "empty" && (input.payload[field] ?? "") === "")) {
        unstored.add(field);
      }
      continue;
    }
    const submitted = input.payload[field] ?? "";
    const shown = input.previousShown.fields[field];
    const unchangedFill = input.previousShown.provenance[field] === "directory" && submitted === shown;
    if (unchangedFill || (submitted === "" && shown === "")) {
      unstored.add(field);
    }
  }
  return unstored;
}

async function writeDocumentFields(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  fields: DocumentFieldFormInput;
  document: DocumentRow;
  partyProvenance: PartySwapProvenance | null;
  /** The party values taken from the register by her action; they carry `register`. */
  taken?: readonly PartySwapField[];
}): Promise<DocumentActionResult> {
  const { document } = input;
  const taken = input.taken ?? [];
  const parsed = parseConfirmedFieldsFromInput(input.fields);
  if (!parsed.ok) {
    return { ok: false, message: parsed.reason };
  }

  const previousConfirmed = parseConfirmedPayload(document.confirmedPayloadJson);
  const previous = readExportSectionOverride(previousConfirmed);
  const next = readExportSectionOverride(parsed.payload);

  const profile = await getCompanyProfile(input.companyId);
  const extracted = parseExtractedPayload(document.extractedPayloadJson);
  const previousMerged = mergeDocumentFields(extracted, previousConfirmed, {
    folderSlot: document.folderSlot,
    profile,
    extractionPipelineVersion: document.extractionPipelineVersion,
  });
  // What she saw: the directory's fills included, for the party badges.
  const { merged: previousShown } = await mergeDocumentFieldsWithDirectory(extracted, previousConfirmed, {
    folderSlot: document.folderSlot,
    profile,
    extractionPipelineVersion: document.extractionPipelineVersion,
  });
  const nextPayload: ConfirmedPayload = { ...parsed.payload };
  // An ordinary save keeps her settlement decision: it is not a field of the form.
  if (previousConfirmed.advanceSettlement) {
    nextPayload.advanceSettlement = previousConfirmed.advanceSettlement;
  }
  const dropped = unstoredPartyFields({
    swapped: input.partyProvenance,
    previousShown,
    payload: nextPayload,
    taken,
  });
  for (const field of dropped) {
    delete (nextPayload as Record<string, unknown>)[field];
  }
  const partyProvenance = nextPartyProvenance({
    swapped: input.partyProvenance,
    previousConfirmed,
    previousShown,
    payload: nextPayload,
    taken,
    dropped,
  });
  if (partyProvenance) {
    nextPayload.partyProvenance = partyProvenance;
  }
  const derivedKeys = new Set([
    ...Object.keys(previousConfirmed.derived ?? {}),
    ...Object.keys(previousMerged.provenance).filter(
      (key) => previousMerged.provenance[key as keyof typeof previousMerged.provenance] === "derived",
    ),
  ]);
  const dependencyChanged = {
    amountLiteral: input.fields.amountLiteral !== previousMerged.fields.amountLiteral,
    recapBaseLiteral: input.fields.recapBaseLiteral !== previousMerged.fields.recapBaseLiteral,
    supplierIcDph: input.fields.icDph !== previousMerged.fields.icDph,
    vatRecap: !equalJson(
      parsed.payload.vatRecap ?? [],
      previousMerged.fields.vatRecap,
    ),
  };

  const initialDerived: ConfirmedPayload["derived"] = {
    ...(nextPayload.derived ?? {}),
  };
  for (const key of Object.keys(DERIVED_DEPENDENCIES)) {
    const provenance = previousMerged.provenance[key as keyof typeof previousMerged.provenance];
    if (provenance === "derived" && !derivedFieldChanged(key, previousMerged.fields, nextPayload)) {
      initialDerived[key] = {
        dependencies: dependenciesFor(key, previousMerged),
        dependencyValues: dependencyValuesFor(
          key,
          previousMerged,
          document.folderSlot,
          profile?.country ?? "",
        ),
      };
    }
  }
  if (Object.keys(initialDerived).length > 0) {
    nextPayload.derived = initialDerived;
  }

  for (const key of derivedKeys) {
    if (derivedFieldChanged(key, previousMerged.fields, nextPayload)) {
      delete nextPayload.derived?.[key];
      continue;
    }
    const dependencies =
      nextPayload.derived?.[key]?.dependencies ?? dependenciesFor(key, previousMerged);
    const stale = dependencies.some((dependency) =>
      dependency === "amountLiteral"
        ? dependencyChanged.amountLiteral
        : dependency === "recapBaseLiteral"
          ? dependencyChanged.recapBaseLiteral
          : dependency === "vatRecap"
            ? dependencyChanged.vatRecap
            : dependency === "supplierIcDph"
              ? dependencyChanged.supplierIcDph
            : false,
    );
    if (stale) {
      clearDerivedField(nextPayload, key);
      delete nextPayload.derived?.[key];
    }
  }

  const mergedNext = mergeDocumentFields(extracted, nextPayload, {
    folderSlot: document.folderSlot,
    profile,
    extractionPipelineVersion: document.extractionPipelineVersion,
  });
  const derived = { ...(nextPayload.derived ?? {}) };
  for (const key of Object.keys(DERIVED_DEPENDENCIES)) {
    const provenance = mergedNext.provenance[key as keyof typeof mergedNext.provenance];
    if (provenance !== "derived") {
      delete derived[key];
      continue;
    }
    copyDerivedEffectiveValue(nextPayload, key, mergedNext);
    derived[key] = {
      dependencies: dependenciesFor(key, mergedNext),
      dependencyValues: dependencyValuesFor(
        key,
        mergedNext,
        document.folderSlot,
        profile?.country ?? "",
      ),
    };
  }
  if (Object.keys(derived).length > 0) {
    nextPayload.derived = derived;
  } else {
    delete nextPayload.derived;
  }

  await writeConfirmedPayload(input.documentId, nextPayload);

  // A changed party value makes the stored verdict stale: the worker checks it again.
  const identityChanged =
    (await partyIdentityOf(document, profile)) !==
    (await partyIdentityOf({ ...document, confirmedPayloadJson: JSON.stringify(nextPayload) }, profile));
  if (identityChanged) {
    await queueSubjectCheckForDocument(input.documentId).catch((error: unknown) =>
      console.warn(`[subject] could not queue the party check for ${input.documentId}`, error),
    );
  }

  if (previous !== next) {
    await appendUserEvent(new Date().toISOString(), input.companyId, "ExportSectionChanged", {
      monthKey: input.monthKey,
      driveFileId: document.driveFileId,
      documentId: document.id,
      previous,
      next,
    });
  }

  return { ok: true };
}

/** The values of one side of the parties, in the field names the form uses. */
function sideFieldsOf(side: "supplier" | "customer"): {
  name: PartySwapField;
  ico: PartySwapField;
  dic: PartySwapField;
  icDph: PartySwapField;
} {
  return side === "supplier"
    ? { name: "supplierName", ico: "ico", dic: "dic", icDph: "icDph" }
    : { name: "customerName", ico: "customerIco", dic: "customerDic", icDph: "customerIcDph" };
}

/**
 * *Prevziať z registra* (PRD 0004, story 34): the subject's legal name, DIČ and
 * IČ DPH become the accountant's values for one flagged party, with provenance
 * `register`. Only what the directory knows is written, and the IČO never is.
 * Refused unless the stored verdict of that party holds a register mismatch
 * judged for the document's current values, and the document is still open.
 */
export async function takePartyFromRegister(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  side: "supplier" | "customer";
  now?: string;
}): Promise<DocumentActionResult> {
  const loaded = await loadEditableDocument(input);
  if (!loaded.ok) {
    return loaded;
  }
  const { document } = loaded;
  if (document.exportedAt !== null) {
    return { ok: false, message: "Doklad je už exportovaný do Omegy, údaje z registra sa nedajú prevziať." };
  }

  const profile = await getCompanyProfile(input.companyId);
  const fields = await mergedPartyFieldsOf(document, profile);
  const record = parsePartyIntegrityRecord(document.partyIntegrityJson);
  const verdict = record && record.identity === partyIdentityKey(fields, clientIdentityOf(profile))
    ? record[input.side]
    : null;
  if (!verdict || !offersRegisterTakeover(verdict)) {
    return { ok: false, message: "Pri tejto strane nie je nič, čo by sa dalo prevziať z registra." };
  }

  const columns = sideFieldsOf(input.side);
  const party: PartyIdentity = {
    name: fields[columns.name],
    ico: fields[columns.ico],
    dic: fields[columns.dic],
    icDph: fields[columns.icDph],
  };
  const subject = await resolveSubject(party);
  if (!subject) {
    return { ok: false, message: "Subjekt sa v adresári nenašiel — over IČO." };
  }
  const registerValues: Partial<Record<PartySwapField, string>> = {};
  if (subject.legalName) registerValues[columns.name] = subject.legalName;
  if (subject.dic) registerValues[columns.dic] = subject.dic;
  if (subject.icDph) registerValues[columns.icDph] = subject.icDph;
  const taken = Object.keys(registerValues) as PartySwapField[];
  if (taken.length === 0) {
    return { ok: false, message: "Register nemá údaje, ktoré by sa dali prevziať." };
  }

  const overrides = Object.fromEntries(
    taken.map((field) => [field, registerValues[field]]),
  ) as Partial<PartySwapValues>;
  const written = await writeDocumentFields({
    companyId: input.companyId,
    monthKey: input.monthKey,
    documentId: input.documentId,
    fields: documentFormOf(fields, overrides, readExportSectionOverride(parseConfirmedPayload(document.confirmedPayloadJson))),
    document,
    partyProvenance: null,
    taken,
  });
  if (!written.ok) {
    return written;
  }

  await appendUserEvent(input.now ?? new Date().toISOString(), input.companyId, "PartyTakenFromRegister", {
    monthKey: input.monthKey,
    driveFileId: document.driveFileId,
    documentId: document.id,
    side: input.side,
  });
  return { ok: true };
}

/** The form the panel would save for these merged values, with some party values overridden. */
function documentFormOf(
  fields: EditableDocumentFields,
  overrides: Partial<PartySwapValues>,
  exportSection: ExportSectionOverride,
): DocumentFieldFormInput {
  return {
    exportSection: exportSection ?? "",
    supplierName: fields.supplierName,
    ico: fields.ico,
    dic: fields.dic,
    icDph: fields.icDph,
    customerName: fields.customerName,
    customerIco: fields.customerIco,
    customerDic: fields.customerDic,
    customerIcDph: fields.customerIcDph,
    ...overrides,
    documentNumber: fields.documentNumber,
    variableSymbol: fields.variableSymbol,
    issueDateRaw: fields.issueDateRaw,
    taxableSupplyDateRaw: fields.taxableSupplyDateRaw,
    dueDateRaw: fields.dueDateRaw,
    receiptNumber: fields.receiptNumber,
    receiptTimestampRaw: fields.receiptTimestampRaw,
    currency: fields.currency,
    amountLiteral: fields.amountLiteral,
    recapBaseLiteral: fields.recapBaseLiteral,
    recapVatLiteral: fields.recapVatLiteral,
    vatRecap: fields.vatRecap.map((row) => ({
      rateLiteral: row.rateLiteral,
      baseLiteral: row.baseLiteral,
      vatLiteral: row.vatLiteral,
    })),
  };
}
