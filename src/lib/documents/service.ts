import { appendUserEvent } from "@/adapters/store/events";
import {
  getDocument,
  setDocumentDecision,
  updateDocumentNote,
  writeConfirmedPayload,
} from "@/adapters/store/documents";
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
  driveFileId: string;
  confirmed: boolean;
  now?: string;
}): DocumentActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = getDocument(input.driveFileId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Document not found in this month." };
  }

  const now = input.now ?? new Date().toISOString();
  if (input.confirmed) {
    setDocumentDecision(input.driveFileId, "confirmed", {
      decidedAt: now,
      notRelevantReason: null,
    });
    appendUserEvent(now, input.companyId, "Confirmed", {
      monthKey: input.monthKey,
      driveFileId: input.driveFileId,
    });
  } else {
    setDocumentDecision(input.driveFileId, null, {
      decidedAt: null,
      notRelevantReason: null,
    });
  }

  return { ok: true };
}

export function dismissDocument(input: {
  companyId: number;
  monthKey: string;
  driveFileId: string;
  reason?: string;
  now?: string;
}): DocumentActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = getDocument(input.driveFileId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Document not found in this month." };
  }

  const now = input.now ?? new Date().toISOString();
  setDocumentDecision(input.driveFileId, "not_relevant", {
    decidedAt: now,
    notRelevantReason: input.reason?.trim() || null,
  });

  return { ok: true };
}

export function saveDocumentNote(input: {
  companyId: number;
  monthKey: string;
  driveFileId: string;
  note: string;
}): DocumentActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = getDocument(input.driveFileId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Document not found in this month." };
  }

  updateDocumentNote(input.driveFileId, input.note.trim() || null);
  return { ok: true };
}

export function saveDocumentFields(input: {
  companyId: number;
  monthKey: string;
  driveFileId: string;
  fields: DocumentFieldFormInput;
}): DocumentActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const document = getDocument(input.driveFileId);
  if (
    !document ||
    document.companyId !== input.companyId ||
    document.monthKey !== input.monthKey
  ) {
    return { ok: false, message: "Document not found in this month." };
  }

  const parsed = parseConfirmedFieldsFromInput(input.fields);
  if (!parsed.ok) {
    return { ok: false, message: parsed.reason };
  }

  writeConfirmedPayload(input.driveFileId, parsed.payload);
  return { ok: true };
}
