import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { getSettings, resolveDriveParentFolderId, setDriveParentFolderId } from "@/adapters/store/settings";
import { scheduleDocumentExtractionForMonth } from "@/lib/cash-discovery/schedule";
import { ensureAllOpenMonthsScaffolded } from "@/lib/month-lifecycle/service";
import { isSweepStale } from "@/lib/sweep/stale";
import { runSweep } from "@/lib/sweep/run-sweep";
import { listCompanySummaries } from "@/lib/sweep/views";

export function isDriveConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DRIVE_CLIENT === "fake" || Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

/**
 * The sweep (ADR 0003) and month scaffolding. `onlyIfStale` is the dashboard's
 * case; a Drive notification or the poll sweeps regardless (ADR 0020).
 */
export async function sweepDrive(
  env: NodeJS.ProcessEnv,
  options: { onlyIfStale: boolean },
): Promise<void> {
  const parentFolderId = resolveDriveParentFolderId(env);
  if (!parentFolderId || !isDriveConfigured(env)) {
    return;
  }

  const settings = getSettings();
  if (!settings.driveParentFolderId && env.DRIVE_PARENT_FOLDER_ID) {
    setDriveParentFolderId(env.DRIVE_PARENT_FOLDER_ID);
  }

  const driveClient = createDriveClient(env);
  if (!options.onlyIfStale || isSweepStale(settings.lastSweepAt, Date.now())) {
    await runSweep(driveClient);
  }
  await ensureAllOpenMonthsScaffolded(driveClient);
}

export async function ensureFreshSweep(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await sweepDrive(env, { onlyIfStale: true });
}

/** Queues every open month's unread documents, in the background. */
export function queueOpenMonthsForExtraction(env: NodeJS.ProcessEnv = process.env): void {
  for (const company of listCompanySummaries(null)) {
    if (company.openMonth && !company.monthClosed) {
      scheduleDocumentExtractionForMonth(company.id, company.openMonth, env);
    }
  }
}

/** Sweeps Drive and queues what arrived: a notification's and the poll's work. */
export async function syncDriveAndQueueExtraction(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await sweepDrive(env, { onlyIfStale: false });
  queueOpenMonthsForExtraction(env);
}
