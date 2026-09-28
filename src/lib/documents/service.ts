import { appendUserEvent } from "@/adapters/store/events";
import {
  getDocument,
  setDocumentDecision,
  updateDocumentNote,
  writeConfirmedPayload,
} from "@/adapters/store/documents";
import { parseConfirmedPayload } from "@/modules/document-payload";
import { readExportSectionOverride } from "@/modules/omega-export-section";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import {
  parseConfirmedFieldsFromInput,
  type DocumentFieldFormInput,
} from "@/modules/document-fields";

export type DocumentActionResult =
  | { ok: true }
  | { ok: false; message: string };

export function confirmDocument(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  confirmed: boolean;
  now?: string;
}): DocumentActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = getDocument(input.documentId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }

  const now = input.now ?? new Date().toISOString();
  if (input.confirmed) {
    setDocumentDecision(input.documentId, "confirmed", {
      decidedAt: now,
      notRelevantReason: null,
    });
    appendUserEvent(now, input.companyId, "Confirmed", {
      monthKey: input.monthKey,
      driveFileId: document.driveFileId,
      documentId: document.id,
    });
  } else {
    setDocumentDecision(input.documentId, null, {
      decidedAt: null,
      notRelevantReason: null,
    });
  }

  return { ok: true };
}

export function dismissDocument(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  reason?: string;
  now?: string;
}): DocumentActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = getDocument(input.documentId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }

  const now = input.now ?? new Date().toISOString();
  setDocumentDecision(input.documentId, "not_relevant", {
    decidedAt: now,
    notRelevantReason: input.reason?.trim() || null,
  });

  return { ok: true };
}

export function saveDocumentNote(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  note: string;
}): DocumentActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = getDocument(input.documentId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }

  updateDocumentNote(input.documentId, input.note.trim() || null);
  return { ok: true };
}

export function saveDocumentFields(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  fields: DocumentFieldFormInput;
}): DocumentActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = getDocument(input.documentId);
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

  const previous = readExportSectionOverride(
    parseConfirmedPayload(document.confirmedPayloadJson),
  );
  const next = readExportSectionOverride(parsed.payload);

  writeConfirmedPayload(input.documentId, parsed.payload);

  if (previous !== next) {
    appendUserEvent(new Date().toISOString(), input.companyId, "ExportSectionChanged", {
      monthKey: input.monthKey,
      driveFileId: document.driveFileId,
      documentId: document.id,
      previous,
      next,
    });
  }

  return { ok: true };
}
