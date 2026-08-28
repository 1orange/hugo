import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { getSettings } from "@/adapters/store/settings";
import { isSweepStale } from "@/lib/sweep/stale";
import { runSweep } from "@/lib/sweep/run-sweep";
import { setDriveParentFolderId } from "@/adapters/store/settings";
import { ensureAllOpenMonthsScaffolded } from "@/lib/month-lifecycle/service";

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

  const driveConfigured =
    env.DRIVE_CLIENT === "fake" || Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  if (isSweepStale(settings.lastSweepAt, Date.now()) && driveConfigured) {
    const driveClient = createDriveClient(env);
    await runSweep(driveClient);
    await ensureAllOpenMonthsScaffolded(driveClient);
    return;
  }

  if (driveConfigured) {
    await ensureAllOpenMonthsScaffolded(createDriveClient(env));
  }
}
