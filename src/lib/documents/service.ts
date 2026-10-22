import { appendUserEvent } from "@/adapters/store/events";
import {
  getDocument,
  setDocumentDecision,
  updateDocumentNote,
  writeConfirmedPayload,
} from "@/adapters/store/documents";
import { getCompanyProfile } from "@/adapters/store/company-profiles";
import { parseConfirmedPayload, parseExtractedPayload, type ConfirmedPayload } from "@/modules/document-payload";
import { readExportSectionOverride } from "@/modules/omega-export-section";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import {
  parseConfirmedFieldsFromInput,
  mergeDocumentFields,
  type DocumentFieldFormInput,
} from "@/modules/document-fields";

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

export async function saveDocumentFields(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  fields: DocumentFieldFormInput;
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
  const nextPayload: ConfirmedPayload = { ...parsed.payload };
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
