import type { DriveClient } from "@/adapters/drive/port";
import { appendEvents } from "@/adapters/store/events";
import { upsertCompany } from "@/adapters/store/companies";
import {
  listStoredFilesForSweep,
  upsertFiles,
  type PersistedFileRow,
} from "@/adapters/store/files";
import { upsertMonth } from "@/adapters/store/months";
import { getSettings, updateLastSweepAt } from "@/adapters/store/settings";
import { buildDriveTree, type DomainEvent } from "@/modules/drive-tree";

export type SweepResult = {
  sweepAt: string;
  eventCount: number;
  companyCount: number;
};

export async function runSweep(driveClient: DriveClient): Promise<SweepResult> {
  const settings = getSettings();
  if (!settings.driveParentFolderId) {
    throw new Error("DRIVE_PARENT_FOLDER_ID is not configured");
  }

  const sweepAt = new Date().toISOString();
  const driveFiles = await driveClient.list();
  const storedFiles = listStoredFilesForSweep();
  const { tree, events, updatedFiles } = buildDriveTree({
    files: driveFiles,
    driveParentFolderId: settings.driveParentFolderId,
    storedFiles,
    sweepAt,
    settings: { canonicalFolderNames: settings.canonicalFolderNames },
  });

  const companyIdByDriveFolderId = new Map<string, number>();
  for (const company of tree) {
    const row = upsertCompany(company.driveFolderId, company.name);
    companyIdByDriveFolderId.set(company.driveFolderId, row.id);

    for (const month of company.months) {
      upsertMonth(row.id, month.key, month.driveFolderId);
    }
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

  upsertFiles(persistedFiles);

  const companyIdByFileId = new Map(
    persistedFiles.map((file) => [file.driveFileId, file.companyId]),
  );

  appendEvents(sweepAt, events, (event: DomainEvent) => {
    if (
      event.type === "FileDiscovered" ||
      event.type === "FileMovedByClient"
    ) {
      return companyIdByDriveFolderId.get(event.companyDriveFolderId) ?? null;
    }
    return companyIdByFileId.get(event.driveFileId) ?? null;
  });

  updateLastSweepAt(sweepAt);

  return {
    sweepAt,
    eventCount: events.length,
    companyCount: tree.length,
  };
}
