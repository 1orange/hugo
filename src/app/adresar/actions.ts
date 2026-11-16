"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { isEmailAllowed, loadAllowlistFromEnv } from "@/lib/auth/allowlist";
import { scheduleSubjectCheckForDocument } from "@/lib/subject-directory/schedule";
import { correctSubjectByHand, restoreRegisterValueByHand } from "@/lib/subject-directory/correction";

export type SubjectCorrectionResult =
  | { ok: true; changed: boolean }
  | { ok: false; message: string };

/** Every allowlisted user may correct the directory (ADR 0011): the allowlist is the whole authorisation. */
async function deniedMessage(): Promise<string | null> {
  const session = await auth();
  const allowlist = loadAllowlistFromEnv();

  if (!session?.user?.email) {
    return "Pred úpravou sa musíte prihlásiť.";
  }
  if (!isEmailAllowed(session.user.email, allowlist)) {
    return "Tento účet nemá prístup.";
  }
  return null;
}

/**
 * Her correction of one field of a subject (PRD 0004, story 50). The correction is
 * checked, marked manual, logged, and the documents that reference the subject are
 * queued for a fresh party check on the worker.
 */
export async function correctSubjectAction(input: {
  subjectId: number;
  field: string;
  value: string;
}): Promise<SubjectCorrectionResult> {
  const denied = await deniedMessage();
  if (denied) {
    return { ok: false, message: denied };
  }

  const outcome = await correctSubjectByHand({
    subjectId: input.subjectId,
    field: input.field,
    value: input.value,
    recheckDocuments: async (documentIds) => {
      for (const documentId of documentIds) {
        await scheduleSubjectCheckForDocument(documentId);
      }
    },
  });
  if (!outcome.ok) {
    return { ok: false, message: outcome.message };
  }

  revalidatePath(`/adresar/${input.subjectId}`);
  revalidatePath("/adresar");
  return { ok: true, changed: outcome.changed };
}

/**
 * Returns a hand-edited identity field to the register's value (0006/03), in one click.
 * Shown on the Adresár entry and on the company's profile, so both pages are revalidated.
 */
export async function restoreRegisterValueAction(input: {
  subjectId: number;
  field: string;
}): Promise<SubjectCorrectionResult> {
  const denied = await deniedMessage();
  if (denied) {
    return { ok: false, message: denied };
  }

  const outcome = await restoreRegisterValueByHand({
    subjectId: input.subjectId,
    field: input.field,
    recheckDocuments: async (documentIds) => {
      for (const documentId of documentIds) {
        await scheduleSubjectCheckForDocument(documentId);
      }
    },
  });
  if (!outcome.ok) {
    return { ok: false, message: outcome.message };
  }

  revalidatePath(`/adresar/${input.subjectId}`);
  revalidatePath("/adresar");
  if (outcome.subject.linkedCompanyId !== null) {
    revalidatePath(`/companies/${outcome.subject.linkedCompanyId}/profile`);
  }
  return { ok: true, changed: true };
}
