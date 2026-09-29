import type { DriveClient } from "@/adapters/drive/port";
import { appendUserEvent } from "@/adapters/store/events";
import {
  getMutationById,
  insertPendingMutation,
  markMutationApplied,
  markMutationFailed,
  markMutationUndone,
} from "@/adapters/store/drive-mutations";
import { getMonthFolder } from "@/adapters/store/month-folders";
import { getMonthByDriveFolderId } from "@/adapters/store/months";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import {
  checkRenameAllowed,
  checkRenameTarget,
  type RenameMutationInput,
} from "@/modules/drive-mutation";
import { getSettings } from "@/adapters/store/settings";
import { runSweep } from "@/lib/sweep/run-sweep";

export type ApplyRenameResult =
  | { ok: true; mutationId: number; appliedAt: string }
  | { ok: false; message: string };

export async function applyFolderRename(
  driveClient: DriveClient,
  companyId: number,
  input: RenameMutationInput,
): Promise<ApplyRenameResult> {
  const month = await getMonthByDriveFolderId(input.parentId);
  if (month) {
    const editable = await assertMonthEditable(companyId, month.monthKey);
    if (editable) {
      return { ok: false, message: editable.message };
    }
  } else {
    const folder = await getMonthFolder(input.driveFileId);
    if (folder) {
      const editable = await assertMonthEditable(companyId, folder.monthKey);
      if (editable) {
        return { ok: false, message: editable.message };
      }
    }
  }

  const capability = checkRenameAllowed(input);
  if (!capability.allowed) {
    return { ok: false, message: capability.message };
  }

  const settings = await getSettings();
  const target = checkRenameTarget({
    currentName: input.currentName,
    targetName: input.targetName,
    canonicalFolderNames: settings.canonicalFolderNames,
  });
  if (!target.allowed) {
    return { ok: false, message: target.message };
  }

  const intendedAt = new Date().toISOString();
  const mutation = await insertPendingMutation({
    kind: "rename",
    driveFileId: input.driveFileId,
    companyId,
    previousParent: input.parentId,
    previousName: input.currentName,
    newParent: input.parentId,
    newName: input.targetName,
    intendedAt,
  });

  try {
    await driveClient.rename(input.driveFileId, input.targetName);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Drive rename failed";
    await markMutationFailed(mutation.id, message);
    return { ok: false, message: `Drive refused the rename: ${message}` };
  }

  const appliedAt = new Date().toISOString();
  await markMutationApplied(mutation.id, appliedAt);

  await appendUserEvent(appliedAt, companyId, "Renamed", {
    driveFileId: input.driveFileId,
    previousName: input.currentName,
    newName: input.targetName,
    mutationId: mutation.id,
  });

  await runSweep(driveClient);

  return { ok: true, mutationId: mutation.id, appliedAt };
}

export type UndoRenameResult =
  | { ok: true; undoneAt: string }
  | { ok: false; message: string };

export async function undoFolderRename(
  driveClient: DriveClient,
  mutationId: number,
): Promise<UndoRenameResult> {
  const mutation = await getMutationById(mutationId);
  if (!mutation || mutation.undoneAt) {
    return { ok: false, message: "Mutation not found or already undone." };
  }
  if (mutation.kind !== "rename") {
    return { ok: false, message: "Only rename mutations can be undone here." };
  }
  if (mutation.status !== "applied") {
    return {
      ok: false,
      message:
        "This mutation was never confirmed as applied to Drive, so there is nothing to reverse.",
    };
  }

  // Someone may have renamed the folder again since. Reverting blind would
  // silently discard that newer name.
  const folder = await getMonthFolder(mutation.driveFileId);
  if (folder && folder.name !== mutation.newName) {
    return {
      ok: false,
      message: `This folder is now named "${folder.name}", not "${mutation.newName}". Undo would discard that change, so it was not applied.`,
    };
  }

  await driveClient.rename(mutation.driveFileId, mutation.previousName);

  const undoneAt = new Date().toISOString();
  await markMutationUndone(mutationId, undoneAt);

  await appendUserEvent(undoneAt, mutation.companyId, "Renamed", {
    driveFileId: mutation.driveFileId,
    previousName: mutation.newName,
    newName: mutation.previousName,
    mutationId,
    undone: true,
  });

  await runSweep(driveClient);

  return { ok: true, undoneAt };
}
