import { canListPermissions, type DriveClient } from "@/adapters/drive/port";
import { recordCompanyAccessError, replaceCompanyPrincipals } from "@/adapters/store/company-access";
import { principalsFromPermissions } from "@/modules/company-access";

/**
 * Folders read at once. About one Drive call per company, so with every company
 * this is a few seconds, not a minute, and Drive's per-user rate is not hit.
 */
const CONCURRENCY = 4;

export type AccessRefreshTarget = { companyId: number; driveFolderId: string };

export type AccessRefreshOutcome = { supported: boolean; refreshed: number; failed: number };

/**
 * Reads each target folder's sharing and stores it. A client without the
 * capability is left alone (`supported: false`). A failed read is recorded on
 * its company and keeps that company's previous snapshot; the others go on.
 */
export async function refreshCompanyAccess(
  driveClient: DriveClient,
  targets: readonly AccessRefreshTarget[],
  now: Date = new Date(),
): Promise<AccessRefreshOutcome> {
  if (!canListPermissions(driveClient)) {
    return { supported: false, refreshed: 0, failed: 0 };
  }

  const pending = [...targets];
  let refreshed = 0;
  let failed = 0;

  const worker = async (): Promise<void> => {
    for (let target = pending.shift(); target; target = pending.shift()) {
      try {
        const permissions = await driveClient.listPermissions(target.driveFolderId);
        await replaceCompanyPrincipals(target.companyId, principalsFromPermissions(permissions), now.toISOString());
        refreshed += 1;
      } catch (error) {
        failed += 1;
        // The message names the status Drive answered, never the folder or its people.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[access] could not read a company folder's sharing: ${message}`);
        await recordCompanyAccessError(target.companyId, message);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));
  return { supported: true, refreshed, failed };
}
