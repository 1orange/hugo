"use server";

import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { listMonthFolders } from "@/adapters/store/month-folders";
import { setDriveParentFolderId } from "@/adapters/store/settings";
import {
  applyFolderRename,
  undoFolderRename,
} from "@/lib/drive-mutations/apply-rename";
import {
  assertMonthEditable,
  closeCompanyMonth,
  reopenCompanyMonth,
  ensureAllOpenMonthsScaffolded,
} from "@/lib/month-lifecycle/service";
import { runSweep } from "@/lib/sweep/run-sweep";
import { revalidatePath } from "next/cache";

export async function refreshSweepAction(): Promise<{ sweepAt: string }> {
  const parentFolderId = process.env.DRIVE_PARENT_FOLDER_ID;
  if (!parentFolderId) {
    throw new Error("DRIVE_PARENT_FOLDER_ID is not configured");
  }

  setDriveParentFolderId(parentFolderId);
  const driveClient = createDriveClient();
  const result = await runSweep(driveClient);
  await ensureAllOpenMonthsScaffolded(driveClient);
  revalidatePath("/companies");
  return { sweepAt: result.sweepAt };
}

type MutationActionResult =
  | { ok: true }
  | { ok: false; message: string };

export async function confirmFolderRenameAction(input: {
  companyId: number;
  monthKey: string;
  driveFolderId: string;
  targetName: string;
}): Promise<MutationActionResult> {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const parentFolderId = process.env.DRIVE_PARENT_FOLDER_ID;
  if (!parentFolderId) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }

  setDriveParentFolderId(parentFolderId);
  const monthFolders = listMonthFolders(input.companyId, input.monthKey);
  const folder = monthFolders.find(
    (entry) => entry.driveFolderId === input.driveFolderId,
  );
  if (!folder) {
    return { ok: false, message: "Folder not found in this month." };
  }

  const driveClient = createDriveClient();
  // The name to revert to on undo comes from the last sweep, never from the
  // browser: a stale page would otherwise record a previous name that never
  // existed and make undo restore the wrong thing.
  const result = await applyFolderRename(driveClient, input.companyId, {
    driveFileId: input.driveFolderId,
    currentName: folder.name,
    targetName: input.targetName,
    parentId: folder.parentId,
    capabilities: { canRename: folder.canRename },
  });

  if (!result.ok) {
    return result;
  }

  revalidatePath(`/companies/${input.companyId}/${input.monthKey}`);
  revalidatePath("/companies");
  return { ok: true };
}

export async function undoFolderRenameAction(input: {
  companyId: number;
  monthKey: string;
  mutationId: number;
}): Promise<MutationActionResult> {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const parentFolderId = process.env.DRIVE_PARENT_FOLDER_ID;
  if (!parentFolderId) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }

  setDriveParentFolderId(parentFolderId);
  const driveClient = createDriveClient();
  const result = await undoFolderRename(driveClient, input.mutationId);
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/companies/${input.companyId}/${input.monthKey}`);
  revalidatePath("/companies");
  return { ok: true };
}

export async function closeMonthAction(input: {
  companyId: number;
  monthKey: string;
}): Promise<MutationActionResult> {
  const parentFolderId = process.env.DRIVE_PARENT_FOLDER_ID;
  if (!parentFolderId) {
    return { ok: false, message: "DRIVE_PARENT_FOLDER_ID is not configured" };
  }

  setDriveParentFolderId(parentFolderId);
  const result = await closeCompanyMonth(
    createDriveClient(),
    input.companyId,
    input.monthKey,
  );
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/companies/${input.companyId}/${input.monthKey}`);
  revalidatePath("/companies");
  return { ok: true };
}

export async function reopenMonthAction(input: {
  companyId: number;
  monthKey: string;
}): Promise<MutationActionResult> {
  const result = await reopenCompanyMonth(input.companyId, input.monthKey);
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/companies/${input.companyId}/${input.monthKey}`);
  revalidatePath("/companies");
  return { ok: true };
}
