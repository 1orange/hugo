import type { DriveClient } from "@/adapters/drive/port";
import { appendUserEvent } from "@/adapters/store/events";
import {
  insertPendingMutation,
  markMutationApplied,
  markMutationFailed,
} from "@/adapters/store/drive-mutations";
import {
  checkCreateFolderTarget,
  type CreateFolderMutationInput,
} from "@/modules/drive-mutation";
import { getSettings } from "@/adapters/store/settings";
import { runSweep } from "@/lib/sweep/run-sweep";

export type ApplyCreateResult =
  | { ok: true; mutationId: number; driveFileId: string; appliedAt: string }
  | { ok: false; message: string };

export async function applyFolderCreate(
  driveClient: DriveClient,
  companyId: number,
  input: CreateFolderMutationInput,
  options?: { runSweepAfter?: boolean },
): Promise<ApplyCreateResult> {
  const settings = await getSettings();
  const target = checkCreateFolderTarget({
    folderName: input.folderName,
    canonicalFolderNames: settings.canonicalFolderNames,
    allowMonthFolder: input.allowMonthFolder,
  });
  if (!target.allowed) {
    return { ok: false, message: target.message };
  }

  const intendedAt = new Date().toISOString();
  const mutation = await insertPendingMutation({
    kind: "create",
    driveFileId: `pending-create:${intendedAt}:${input.folderName}`,
    companyId,
    previousParent: "",
    previousName: "",
    newParent: input.parentId,
    newName: input.folderName,
    intendedAt,
  });

  let driveFileId: string;
  try {
    driveFileId = await driveClient.createFolder(
      input.folderName,
      input.parentId,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Drive create failed";
    await markMutationFailed(mutation.id, message);
    return { ok: false, message: `Drive refused the create: ${message}` };
  }

  const appliedAt = new Date().toISOString();
  await markMutationApplied(mutation.id, appliedAt);

  await appendUserEvent(appliedAt, companyId, "FolderCreated", {
    driveFileId,
    parentId: input.parentId,
    name: input.folderName,
    mutationId: mutation.id,
  });

  if (options?.runSweepAfter !== false) {
    await runSweep(driveClient);
  }

  return { ok: true, mutationId: mutation.id, driveFileId, appliedAt };
}
