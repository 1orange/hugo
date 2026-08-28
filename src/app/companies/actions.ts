"use server";

import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { setDriveParentFolderId } from "@/adapters/store/settings";
import { runSweep } from "@/lib/sweep/run-sweep";
import { revalidatePath } from "next/cache";

export async function refreshSweepAction(): Promise<{ sweepAt: string }> {
  const parentFolderId = process.env.DRIVE_PARENT_FOLDER_ID;
  if (!parentFolderId) {
    throw new Error("DRIVE_PARENT_FOLDER_ID is not configured");
  }

  setDriveParentFolderId(parentFolderId);
  const result = await runSweep(createDriveClient());
  revalidatePath("/companies");
  return { sweepAt: result.sweepAt };
}
