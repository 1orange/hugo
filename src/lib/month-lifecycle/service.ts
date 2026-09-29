import type { DriveClient } from "@/adapters/drive/port";
import { getCompanyById, listCompanies } from "@/adapters/store/companies";
import { appendUserEvent } from "@/adapters/store/events";
import { listMonthFolders } from "@/adapters/store/month-folders";
import {
  closeMonth as closeMonthRecord,
  getMonthByKey,
  getOpenMonthKey,
  reopenMonth as reopenMonthRecord,
} from "@/adapters/store/months";
import { getSettings } from "@/adapters/store/settings";
import { applyFolderCreate } from "@/lib/drive-mutations/apply-create";
import { runSweep } from "@/lib/sweep/run-sweep";
import { classifyFolder } from "@/modules/folder-taxonomy";
import { nextMonthKey, planMonthScaffolding } from "@/modules/month-lifecycle";

export type MonthActionResult =
  | { ok: true }
  | { ok: false; message: string };

export type MonthReadOnlyBlock = { ok: false; message: string };

export async function assertMonthEditable(
  companyId: number,
  monthKey: string,
): Promise<MonthReadOnlyBlock | null> {
  const month = await getMonthByKey(companyId, monthKey);
  if (!month) {
    return { ok: false, message: "Mesiac sa nenašiel." };
  }
  if (month.closedAt) {
    return {
      ok: false,
      message: "Tento mesiac je uzavretý a len na čítanie.",
    };
  }
  return null;
}

export async function scaffoldMonthSubfolders(
  driveClient: DriveClient,
  companyId: number,
  monthDriveFolderId: string,
  monthKey: string,
  options?: { runSweepAfter?: boolean },
): Promise<number> {
  const settings = await getSettings();
  const existing = await listMonthFolders(companyId, monthKey);
  const existingWithClassification = existing.map((folder) => ({
    name: folder.name,
    classification: classifyFolder(folder.name, {
      canonicalFolderNames: settings.canonicalFolderNames,
    }),
  }));

  const toCreate = planMonthScaffolding(
    existingWithClassification,
    settings.canonicalFolderNames,
  );

  for (const folderName of toCreate) {
    const result = await applyFolderCreate(
      driveClient,
      companyId,
      {
        folderName,
        parentId: monthDriveFolderId,
      },
      { runSweepAfter: false },
    );
    if (!result.ok) {
      throw new Error(result.message);
    }
  }

  if (toCreate.length > 0 && options?.runSweepAfter !== false) {
    await runSweep(driveClient);
  }

  return toCreate.length;
}

async function ensureMonthFolderInDrive(
  driveClient: DriveClient,
  companyId: number,
  companyDriveFolderId: string,
  monthKey: string,
): Promise<string> {
  const existing = await getMonthByKey(companyId, monthKey);
  if (existing) {
    return existing.driveFolderId;
  }

  const result = await applyFolderCreate(
    driveClient,
    companyId,
    {
      folderName: monthKey,
      parentId: companyDriveFolderId,
      allowMonthFolder: true,
    },
    { runSweepAfter: false },
  );
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.driveFileId;
}

export async function scaffoldOpenMonthIfNeeded(
  driveClient: DriveClient,
  companyId: number,
): Promise<void> {
  const openMonthKey = await getOpenMonthKey(companyId);
  if (!openMonthKey) {
    return;
  }

  const month = await getMonthByKey(companyId, openMonthKey);
  if (!month) {
    return;
  }

  await scaffoldMonthSubfolders(
    driveClient,
    companyId,
    month.driveFolderId,
    openMonthKey,
  );
}

export async function ensureAllOpenMonthsScaffolded(
  driveClient: DriveClient,
): Promise<void> {
  for (const company of await listCompanies()) {
    await scaffoldOpenMonthIfNeeded(driveClient, company.id);
  }
}

export async function closeCompanyMonth(
  driveClient: DriveClient,
  companyId: number,
  monthKey: string,
): Promise<MonthActionResult & { nextMonthKey?: string }> {
  const editable = await assertMonthEditable(companyId, monthKey);
  if (editable) {
    return editable;
  }

  /*
   * Any month that is not already closed can be closed, not only the most
   * recent one. ADR 0005 anchors the lifecycle on the explicit click and
   * *derives* the open month as the newest without a `closedAt`; that
   * derivation still holds when an older month is closed out of order, which
   * happens whenever a late month is finished after a newer one was started.
   * `assertMonthEditable` above already rejects an already-closed month.
   */
  const month = await getMonthByKey(companyId, monthKey);
  if (!month) {
    return { ok: false, message: "Mesiac sa nenašiel." };
  }

  const company = await getCompanyById(companyId);
  if (!company) {
    return { ok: false, message: "Firma sa nenašla." };
  }

  const nextKey = nextMonthKey(monthKey);
  if (!nextKey) {
    return { ok: false, message: "Neplatný kľúč mesiaca." };
  }

  const closedAt = new Date().toISOString();
  await closeMonthRecord(companyId, monthKey, closedAt);
  await appendUserEvent(closedAt, companyId, "MonthClosed", { monthKey });

  const nextMonthFolderId = await ensureMonthFolderInDrive(
    driveClient,
    companyId,
    company.driveFolderId,
    nextKey,
  );

  await runSweep(driveClient);

  await scaffoldMonthSubfolders(
    driveClient,
    companyId,
    nextMonthFolderId,
    nextKey,
  );

  return { ok: true, nextMonthKey: nextKey };
}

export async function reopenCompanyMonth(
  companyId: number,
  monthKey: string,
): Promise<MonthActionResult> {
  const month = await getMonthByKey(companyId, monthKey);
  if (!month) {
    return { ok: false, message: "Mesiac sa nenašiel." };
  }
  if (!month.closedAt) {
    return { ok: false, message: "Mesiac nie je uzavretý." };
  }

  const reopenedAt = new Date().toISOString();
  await reopenMonthRecord(companyId, monthKey);
  await appendUserEvent(reopenedAt, companyId, "MonthReopened", { monthKey });

  return { ok: true };
}
