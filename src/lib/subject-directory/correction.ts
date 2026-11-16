import { appendGlobalUserEvent } from "@/adapters/store/events";
import {
  getSubject,
  listSubjectReferences,
  updateSubject,
  type SubjectPatch,
  type SubjectRow,
} from "@/adapters/store/subjects";
import { restoreRegisterValueOf, type SubjectField } from "@/modules/subject-directory";
import {
  isCorrectableSubjectField,
  validateSubjectCorrection,
  type CorrectableSubjectField,
} from "@/modules/subject-screen";
import { correctSubjectField } from "./service";
import { scheduleClientSubjectCheckForSubject } from "./schedule";

/**
 * Her correction of a subject's field on the *Adresár* screen (PRD 0004 story 50–51,
 * ADR 0022): checked, stored as `manual`, recorded in the event log, and the documents
 * that reference the subject are queued for a fresh party check. The one place the
 * screen's action and the tests make a correction.
 */

export type CorrectionOutcome =
  | { ok: true; changed: boolean; subject: SubjectRow }
  | { ok: false; message: string };

export type CorrectionInput = {
  subjectId: number;
  field: string;
  /** What she typed. */
  value: string;
  now?: string;
  /** Asked with the ids of the documents that reference the subject, once the correction is stored. */
  recheckDocuments?: (documentIds: string[]) => Promise<void>;
};

function currentValue(subject: SubjectRow, field: CorrectableSubjectField): string | null {
  return subject[field] ?? null;
}

export async function correctSubjectByHand(input: CorrectionInput): Promise<CorrectionOutcome> {
  if (!isCorrectableSubjectField(input.field)) {
    return { ok: false, message: "Toto pole sa v adresári nedá upraviť." };
  }
  const field = input.field;
  const subject = await getSubject(input.subjectId);
  if (!subject) {
    return { ok: false, message: "Subjekt sa v adresári nenašiel." };
  }
  const check = validateSubjectCorrection(field, input.value);
  if (!check.ok) {
    return check;
  }

  const previous = currentValue(subject, field);
  if (previous === check.value) {
    return { ok: true, changed: false, subject };
  }

  const now = input.now ?? new Date().toISOString();
  const updated = await correctSubjectField(subject.id, field, check.value, now);
  if (!updated) {
    return { ok: false, message: "Subjekt sa v adresári nenašiel." };
  }
  await appendGlobalUserEvent(now, "SubjectCorrected", {
    subjectId: subject.id,
    subjectName: subject.legalName ?? subject.ico ?? `subjekt ${subject.id}`,
    field,
    previous,
    next: check.value,
  });
  // A client's subject is asked the register again: its answer is what shows the register's value beside her edit (0006/03).
  if (updated.linkedCompanyId !== null) {
    await scheduleClientSubjectCheckForSubject(updated.id);
  }

  if (input.recheckDocuments) {
    const references = await listSubjectReferences(subject.id);
    await input.recheckDocuments(references.map((reference) => reference.documentId));
  }
  return { ok: true, changed: true, subject: updated };
}

export type RestoreOutcome = { ok: true; subject: SubjectRow } | { ok: false; message: string };

/** The fields a register disagreement can be returned on: a finding exists only for these. */
const RESTORABLE_FIELDS: readonly string[] = ["legalName", "address", "dic"];

/**
 * Returns a hand-edited field to the register's value (0006/03): the value is the
 * register's, its source `register`, and the field leaves the manual list. Logged as a
 * correction, and the documents that reference the subject are queued for a fresh check.
 */
export async function restoreRegisterValueByHand(input: {
  subjectId: number;
  field: string;
  now?: string;
  recheckDocuments?: (documentIds: string[]) => Promise<void>;
}): Promise<RestoreOutcome> {
  if (!RESTORABLE_FIELDS.includes(input.field)) {
    return { ok: false, message: "Toto pole register nemá, čomu by sa dalo vrátiť." };
  }
  const field = input.field as SubjectField;
  const subject = await getSubject(input.subjectId);
  if (!subject) {
    return { ok: false, message: "Subjekt sa v adresári nenašiel." };
  }
  const restored = restoreRegisterValueOf(subject, field);
  if (!restored) {
    return { ok: false, message: "Register nemá inú hodnotu, na ktorú by sa dalo vrátiť." };
  }

  const now = input.now ?? new Date().toISOString();
  const updated = await updateSubject(subject.id, {
    [field]: restored.value,
    sources: restored.sources,
    manualFields: restored.manualFields,
    findings: restored.findings,
  } as SubjectPatch);
  if (!updated) {
    return { ok: false, message: "Subjekt sa v adresári nenašiel." };
  }
  await appendGlobalUserEvent(now, "SubjectCorrected", {
    subjectId: subject.id,
    subjectName: subject.legalName ?? subject.ico ?? `subjekt ${subject.id}`,
    field,
    previous: currentValue(subject, field as CorrectableSubjectField),
    next: restored.value,
    restoredFromRegister: true,
  });

  if (input.recheckDocuments) {
    const references = await listSubjectReferences(subject.id);
    await input.recheckDocuments(references.map((reference) => reference.documentId));
  }
  return { ok: true, subject: updated };
}
