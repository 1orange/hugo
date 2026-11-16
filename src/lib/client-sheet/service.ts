import { writeClientSheetProfiles } from "@/adapters/store/client-sheet";
import { listAllCompanies } from "@/adapters/store/companies";
import { listCompanyProfiles } from "@/adapters/store/company-profiles";
import { scheduleClientSubjectCheck } from "@/lib/subject-directory/schedule";
import {
  parseClientSheet,
  planClientSheet,
  selectClientSheetWrites,
  type ClientSheetDecisions,
  type ClientSheetPlan,
} from "@/modules/client-sheet";

/** A real sheet is a few kilobytes; the cap only stops a wrong file from being read whole. */
export const CLIENT_SHEET_MAX_CHARS = 1_000_000;

export type ClientSheetPreview = { ok: true; plan: ClientSheetPlan } | { ok: false; message: string };

/**
 * Plans the sheet against the companies and profiles as they are now. Writes nothing.
 */
export async function previewClientSheet(text: string): Promise<ClientSheetPreview> {
  if (text.length > CLIENT_SHEET_MAX_CHARS) {
    return { ok: false, message: "Súbor je príliš veľký na klientsky hárok." };
  }
  const parsed = parseClientSheet(text);
  if (!parsed.ok) {
    return parsed;
  }
  const [companies, profiles] = await Promise.all([listAllCompanies(), listCompanyProfiles()]);
  return { ok: true, plan: planClientSheet(parsed.rows, companies, profiles) };
}

export type ClientSheetApplied = { companies: number; fields: number };

/**
 * Writes what she decided. The plan is made again from the sheet on the server, so
 * what is written is what the rules allow now, never what a client said was in the preview.
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
  const writes = selectClientSheetWrites(preview.plan, decisions);
  await writeClientSheetProfiles(writes, timestamp);
  // The imported values are checked against the registers, as a profile save's are (0006/03).
  for (const write of writes) {
    await scheduleClientSubjectCheck(write.companyId);
  }
  return {
    ok: true,
    applied: {
      companies: writes.length,
      fields: writes.reduce((total, write) => total + write.written.length, 0),
    },
  };
}
