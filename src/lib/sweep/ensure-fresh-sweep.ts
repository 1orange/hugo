import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { getSettings, resolveDriveParentFolderId, setDriveParentFolderId } from "@/adapters/store/settings";
import { queueReadingWindowForExtraction } from "@/lib/extraction-queue/reading-window";
import { isSweepStale } from "@/lib/sweep/stale";
import { runSweep, sweepUnlessRunning } from "@/lib/sweep/run-sweep";

export function isDriveConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DRIVE_CLIENT === "fake" || Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

/**
 * The sweep (ADR 0003). `onlyIfStale` is the dashboard's case; a Drive
 * notification or the poll sweeps regardless (ADR 0020). The sweep only reads
 * Drive: the office creates the month folders (ADR 0005, amended 2026-11-11).
 */
export async function sweepDrive(
  env: NodeJS.ProcessEnv,
  options: { onlyIfStale: boolean; allAccess?: boolean },
): Promise<void> {
  const parentFolderId = await resolveDriveParentFolderId(env);
  if (!parentFolderId || !isDriveConfigured(env)) {
    return;
  }

  const settings = await getSettings();
  if (!settings.driveParentFolderId && env.DRIVE_PARENT_FOLDER_ID) {
    await setDriveParentFolderId(env.DRIVE_PARENT_FOLDER_ID);
  }

  const driveClient = createDriveClient(env);
  if (!options.onlyIfStale) {
    await runSweep(driveClient, { allAccess: options.allAccess });
  } else if (isSweepStale(settings.lastSweepAt, Date.now())) {
    // Another sweep running brings the database up to date: not worth waiting for.
    await sweepUnlessRunning(driveClient);
  }
}

/**
 * What a page asks for after it has answered (`after()`): a sweep if the last
 * one is stale, then the reading window's unread documents queued. A page never
 * waits for Drive; the screens re-render when the sweep announces a change.
 * Never throws: it runs after the response, where nothing would catch it.
 */
export async function refreshAfterRender(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    await ensureFreshSweep(env);
    await queueReadingWindowForExtraction();
  } catch (error) {
    console.warn("[sweep] the background refresh failed", error);
  }
}

export async function ensureFreshSweep(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await sweepDrive(env, { onlyIfStale: true });
}

/**
 * Sweeps Drive and queues what arrived: a notification's and the poll's work.
 * The reading window is queued after every sweep, so a document a client put
 * in last month's folder is read without anyone opening that month (ADR 0020).
 * `allAccess` is the poll's: it reads every company's sharing, not only the changed ones.
 */
export async function syncDriveAndQueueExtraction(
  env: NodeJS.ProcessEnv = process.env,
  options: { allAccess?: boolean } = {},
): Promise<void> {
  await sweepDrive(env, { onlyIfStale: false, allAccess: options.allAccess });
  await queueReadingWindowForExtraction();
}
