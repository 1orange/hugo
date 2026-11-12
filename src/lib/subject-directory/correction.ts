import { appendGlobalUserEvent } from "@/adapters/store/events";
import { getSubject, listSubjectReferences, type SubjectRow } from "@/adapters/store/subjects";
import {
  isCorrectableSubjectField,
  validateSubjectCorrection,
  type CorrectableSubjectField,
} from "@/modules/subject-screen";
import { correctSubjectField } from "./service";

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

  if (input.recheckDocuments) {
    const references = await listSubjectReferences(subject.id);
    await input.recheckDocuments(references.map((reference) => reference.documentId));
  }
  return { ok: true, changed: true, subject: updated };
}
