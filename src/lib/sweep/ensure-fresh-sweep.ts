import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { getSettings } from "@/adapters/store/settings";
import { isSweepStale } from "@/lib/sweep/stale";
import { runSweep } from "@/lib/sweep/run-sweep";
import { setDriveParentFolderId } from "@/adapters/store/settings";

export async function ensureFreshSweep(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const parentFolderId = env.DRIVE_PARENT_FOLDER_ID;
  if (!parentFolderId) {
    return;
  }

  const settings = getSettings();
  if (!settings.driveParentFolderId) {
    setDriveParentFolderId(parentFolderId);
  }

  if (!isSweepStale(settings.lastSweepAt, Date.now())) {
    return;
  }

  if (env.DRIVE_CLIENT !== "fake" && !env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return;
  }

  await runSweep(createDriveClient(env));
}
