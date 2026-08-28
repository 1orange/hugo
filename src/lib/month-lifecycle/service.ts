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

export function assertMonthEditable(
  companyId: number,
  monthKey: string,
): MonthReadOnlyBlock | null {
  const month = getMonthByKey(companyId, monthKey);
  if (!month) {
    return { ok: false, message: "Month not found." };
  }
  if (month.closedAt) {
    return {
      ok: false,
      message: "This month is closed and read-only.",
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
  const settings = getSettings();
  const existing = listMonthFolders(companyId, monthKey);
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
  const existing = getMonthByKey(companyId, monthKey);
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
  const openMonthKey = getOpenMonthKey(companyId);
  if (!openMonthKey) {
    return;
  }

  const month = getMonthByKey(companyId, openMonthKey);
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
  for (const company of listCompanies()) {
    await scaffoldOpenMonthIfNeeded(driveClient, company.id);
  }
}

export async function closeCompanyMonth(
  driveClient: DriveClient,
  companyId: number,
  monthKey: string,
): Promise<MonthActionResult & { nextMonthKey?: string }> {
  const editable = assertMonthEditable(companyId, monthKey);
  if (editable) {
    return editable;
  }

  const openMonthKey = getOpenMonthKey(companyId);
  if (openMonthKey !== monthKey) {
    return {
      ok: false,
      message: "Only the open month can be closed.",
    };
  }

  const month = getMonthByKey(companyId, monthKey);
  if (!month) {
    return { ok: false, message: "Month not found." };
  }

  const company = getCompanyById(companyId);
  if (!company) {
    return { ok: false, message: "Company not found." };
  }

  const nextKey = nextMonthKey(monthKey);
  if (!nextKey) {
    return { ok: false, message: "Invalid month key." };
  }

  const closedAt = new Date().toISOString();
  closeMonthRecord(companyId, monthKey, closedAt);
  appendUserEvent(closedAt, companyId, "MonthClosed", { monthKey });

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
  const month = getMonthByKey(companyId, monthKey);
  if (!month) {
    return { ok: false, message: "Month not found." };
  }
  if (!month.closedAt) {
    return { ok: false, message: "Month is not closed." };
  }

  const reopenedAt = new Date().toISOString();
  reopenMonthRecord(companyId, monthKey);
  appendUserEvent(reopenedAt, companyId, "MonthReopened", { monthKey });

  return { ok: true };
}
