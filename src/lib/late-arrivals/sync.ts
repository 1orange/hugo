import { listFiles } from "@/adapters/store/files";
import {
  listAllLateArrivals,
  listLateArrivalsForCompany,
  resolveLateArrivals,
  upsertDetectedLateArrival,
} from "@/adapters/store/late-arrivals";
import { listClosedMonths } from "@/adapters/store/months";
import { getSettings, setLateArrivalsSince } from "@/adapters/store/settings";
import { planLateArrivalSync } from "@/modules/late-arrivals";

/**
 * From when uploads into a month no longer booked count as late. The first
 * sweep that applies the rule sets it to its own time: files already in the
 * drive then are history, and only what is uploaded later is proposed.
 */
async function lateArrivalsSince(now: string): Promise<string> {
  const stored = (await getSettings()).lateArrivalsSince;
  if (stored) {
    return stored;
  }
  await setLateArrivalsSince(now);
  return now;
}

/**
 * Brings the log in line with the stored files: logs what arrived in a closed
 * month after its close, or into a month after it stopped being booked, and
 * resolves what is late no more. Run by every sweep,
 * inside its lock, and after a month is reopened.
 */
export async function syncLateArrivals(now: string, companyId?: number): Promise<void> {
  const [closedMonths, files, entries] = await Promise.all([
    listClosedMonths(companyId),
    listFiles(companyId),
    companyId === undefined ? listAllLateArrivals() : listLateArrivalsForCompany(companyId),
  ]);
  const closedAtByMonth = new Map(
    closedMonths.map((month) => [`${month.companyId}:${month.monthKey}`, month.closedAt!]),
  );
  // Months are per company: key every file's month by its company too.
  const plan = planLateArrivalSync({
    files: files.map((file) => ({ ...file, monthKey: `${file.companyId}:${file.monthKey}`, period: file.monthKey })),
    closedAtByMonth,
    entries,
    passedMonthsSince: await lateArrivalsSince(now),
  });
  const companyOfFile = new Map(files.map((file) => [file.driveFileId, file.companyId]));
  for (const detected of plan.detected) {
    const fileCompanyId = companyOfFile.get(detected.driveFileId)!;
    const sourceMonthKey = detected.sourceMonthKey.slice(detected.sourceMonthKey.indexOf(":") + 1);
    await upsertDetectedLateArrival(fileCompanyId, { ...detected, sourceMonthKey }, now);
  }
  await resolveLateArrivals(plan.resolved, now);
}
