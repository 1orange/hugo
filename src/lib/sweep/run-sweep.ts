import type { DriveClient } from "@/adapters/drive/port";
import { appendEvents } from "@/adapters/store/events";
import { upsertCompany } from "@/adapters/store/companies";
import { forgetSystemFiles } from "@/adapters/store/documents";
import {
  listStoredFilesForSweep,
  upsertFiles,
  type PersistedFileRow,
} from "@/adapters/store/files";
import { upsertMonth } from "@/adapters/store/months";
import { replaceMonthFoldersForCompany } from "@/adapters/store/month-folders";
import { getSettings, resolveDriveParentFolderId, updateLastSweepAt } from "@/adapters/store/settings";
import { withAdvisoryLock } from "@/lib/db/client";
import { announce } from "@/lib/events/bus";
import { buildDriveTree, type DomainEvent } from "@/modules/drive-tree";

/** Held while a sweep diffs Drive against the database (ADR 0021). */
const SWEEP_LOCK_KEY = 7_261_670_122;

export type SweepResult = {
  sweepAt: string;
  eventCount: number;
  companyCount: number;
};

/**
 * Brings the database in line with Drive and records what changed. One sweep
 * at a time across replicas: two at once both saw a new file as new. Drive is
 * listed inside the lock too, so a later sweep never writes an older listing.
 */
export async function runSweep(driveClient: DriveClient): Promise<SweepResult> {
  return withAdvisoryLock(SWEEP_LOCK_KEY, () => sweep(driveClient));
}

async function sweep(driveClient: DriveClient): Promise<SweepResult> {
  const settings = await getSettings();
  const driveParentFolderId = await resolveDriveParentFolderId();
  if (!driveParentFolderId) {
    throw new Error("DRIVE_PARENT_FOLDER_ID is not configured");
  }

  const sweepAt = new Date().toISOString();
  const driveFiles = await driveClient.list();
  const storedFiles = await listStoredFilesForSweep();
  const { tree, events, updatedFiles } = buildDriveTree({
    files: driveFiles,
    driveParentFolderId,
    storedFiles,
    sweepAt,
    settings: { canonicalFolderNames: settings.canonicalFolderNames },
  });

  const companyIdByDriveFolderId = new Map<string, number>();
  for (const company of tree) {
    const row = await upsertCompany(company.driveFolderId, company.name);
    companyIdByDriveFolderId.set(company.driveFolderId, row.id);

    for (const month of company.months) {
      await upsertMonth(row.id, month.key, month.driveFolderId);
    }

    await replaceMonthFoldersForCompany(
      row.id,
      company.months.flatMap((month) =>
        month.folderSlots.map((slot) => ({
          driveFolderId: slot.driveFolderId,
          companyId: row.id,
          monthKey: month.key,
          name:
            slot.classification.kind === "canonical"
              ? slot.classification.name
              : slot.classification.kind === "repair-candidate"
                ? slot.classification.observedName
                : slot.classification.name,
          parentId: month.driveFolderId,
          canRename: slot.capabilities?.canRename !== false,
        })),
      ),
    );
  }

  const persistedFiles: PersistedFileRow[] = updatedFiles
    .map((file) => {
      const companyId = companyIdByDriveFolderId.get(file.companyDriveFolderId);
      if (!companyId) {
        return null;
      }
      return {
        driveFileId: file.driveFileId,
        companyId,
        monthKey: file.monthKey,
        folderSlot: file.folderSlot,
        parentId: file.parentId,
        name: file.name,
        mimeType: file.mimeType,
        driveCreatedTime: file.driveCreatedTime,
        firstSeenAt: file.firstSeenAt,
        lastSeenAt: file.lastSeenAt,
        deleted: file.deleted,
      };
    })
    .filter((row): row is PersistedFileRow => row !== null);

  await upsertFiles(persistedFiles);
  await forgetSystemFiles();

  const companyIdByFileId = new Map(
    persistedFiles.map((file) => [file.driveFileId, file.companyId]),
  );

  await appendEvents(sweepAt, events, (event: DomainEvent) => {
    if (
      event.type === "FileDiscovered" ||
      event.type === "FileMovedByClient"
    ) {
      return companyIdByDriveFolderId.get(event.companyDriveFolderId) ?? null;
    }
    return companyIdByFileId.get(event.driveFileId) ?? null;
  });

  await updateLastSweepAt(sweepAt);
  announceChangedMonths(events, storedFiles, persistedFiles, companyIdByDriveFolderId);

  return {
    sweepAt,
    eventCount: events.length,
    companyCount: tree.length,
  };
}

/** Tells the screens which months' files changed, where they were and where they are now. */
function announceChangedMonths(
  events: DomainEvent[],
  before: Awaited<ReturnType<typeof listStoredFilesForSweep>>,
  after: PersistedFileRow[],
  companyIdByDriveFolderId: Map<string, number>,
): void {
  const previous = new Map(before.map((file) => [file.driveFileId, file]));
  const current = new Map(after.map((file) => [file.driveFileId, file]));
  const months = new Map<string, { companyId: number; monthKey: string }>();
  const note = (companyId: number | undefined, monthKey: string) => {
    if (companyId !== undefined) {
      months.set(`${companyId}:${monthKey}`, { companyId, monthKey });
    }
  };
  for (const event of events) {
    const now = current.get(event.driveFileId);
    if (now) {
      note(now.companyId, now.monthKey);
    }
    const was = previous.get(event.driveFileId);
    if (was) {
      note(companyIdByDriveFolderId.get(was.companyDriveFolderId), was.monthKey);
    }
  }
  if (months.size > 0) {
    announce({ type: "files-changed", months: [...months.values()] });
  }
}
