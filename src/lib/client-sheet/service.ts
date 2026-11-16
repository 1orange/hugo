import { writeClientSheet } from "@/adapters/store/client-sheet";
import { listAllCompanies } from "@/adapters/store/companies";
import { listAllSubjects, type SubjectRow } from "@/adapters/store/subjects";
import { scheduleClientSubjectCheck, scheduleClientSubjectCheckForSubject } from "@/lib/subject-directory/schedule";
import {
  parseClientSheet,
  planClientSheet,
  selectAdresarWrites,
  selectClientSheetWrites,
  type ClientSheetDecisions,
  type ClientSheetPlan,
  type MatchSubject,
} from "@/modules/client-sheet";

/** A real sheet is a few kilobytes; the cap only stops a wrong file from being read whole. */
export const CLIENT_SHEET_MAX_CHARS = 1_000_000;

export type ClientSheetPreview = { ok: true; plan: ClientSheetPlan } | { ok: false; message: string };

/** The subjects the sheet is matched and written against: every one with an IČO (0006/04). */
export function matchSubjectsOf(subjects: readonly SubjectRow[]): MatchSubject[] {
  return subjects.flatMap((subject) =>
    subject.ico === null
      ? []
      : [
          {
            id: subject.id,
            country: subject.country,
            ico: subject.ico,
            linkedCompanyId: subject.linkedCompanyId,
            legalName: subject.legalName ?? "",
            address: subject.address ?? "",
            dic: subject.dic ?? "",
            icDph: subject.icDph ?? "",
            officeClient: subject.officeClient,
            officeKeeper: subject.officeKeeper ?? "",
            officeCooperation: subject.officeCooperation ?? "",
          },
        ],
  );
}

/**
 * Plans the sheet against the companies and the Adresár as they are now. Writes nothing.
 */
export async function previewClientSheet(text: string): Promise<ClientSheetPreview> {
  if (text.length > CLIENT_SHEET_MAX_CHARS) {
    return { ok: false, message: "Súbor je príliš veľký na klientsky hárok." };
  }
  const parsed = parseClientSheet(text);
  if (!parsed.ok) {
    return parsed;
  }
  const [companies, subjects] = await Promise.all([listAllCompanies(), listAllSubjects()]);
  return { ok: true, plan: planClientSheet(parsed.rows, companies, matchSubjectsOf(subjects)) };
}

export type ClientSheetApplied = { companies: number; adresar: number; fields: number };

/**
 * Writes what she decided. The plan is made again from the sheet on the server, so
 * what is written is what the rules allow now, never what a client said was in the preview.
 * Every subject written is queued for the register check (0006/03, 0006/04).
 */
export async function applyClientSheet(
  text: string,
  decisions: ClientSheetDecisions,
  timestamp: string,
): Promise<{ ok: true; applied: ClientSheetApplied } | { ok: false; message: string }> {
  const preview = await previewClientSheet(text);
  if (!preview.ok) {
    return preview;
  }
  const profiles = selectClientSheetWrites(preview.plan, decisions);
  const adresar = selectAdresarWrites(preview.plan, decisions);
  const { subjectIds } = await writeClientSheet(profiles, adresar, timestamp);
  // The imported values are checked against the registers, as a profile save's are (0006/03).
  for (const write of profiles) {
    await scheduleClientSubjectCheck(write.companyId);
  }
  for (const subjectId of subjectIds) {
    await scheduleClientSubjectCheckForSubject(subjectId);
  }
  return {
    ok: true,
    applied: {
      companies: profiles.length,
      adresar: adresar.length,
      fields: [...profiles, ...adresar].reduce(
        (total, write) => total + write.written.length + write.office.length,
        0,
      ),
    },
  };
}
