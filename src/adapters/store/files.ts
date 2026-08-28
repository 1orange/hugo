import { and, eq } from "drizzle-orm";
import { companies, files } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import type { StoredFileState } from "@/modules/drive-tree";

export type PersistedFileRow = {
  driveFileId: string;
  companyId: number;
  monthKey: string;
  folderSlot: string | null;
  parentId: string;
  name: string;
  mimeType: string;
  driveCreatedTime: string;
  firstSeenAt: string;
  lastSeenAt: string;
  deleted: boolean;
};

export function listStoredFilesForSweep(): StoredFileState[] {
  const db = getDb();
  const rows = db
    .select({
      driveFileId: files.driveFileId,
      companyDriveFolderId: companies.driveFolderId,
      monthKey: files.monthKey,
      folderSlot: files.folderSlot,
      parentId: files.parentId,
      name: files.name,
      mimeType: files.mimeType,
      driveCreatedTime: files.driveCreatedTime,
      firstSeenAt: files.firstSeenAt,
      lastSeenAt: files.lastSeenAt,
      deleted: files.deleted,
    })
    .from(files)
    .innerJoin(companies, eq(files.companyId, companies.id))
    .all();

  return rows;
}

export function upsertFiles(rows: PersistedFileRow[]): void {
  const db = getDb();
  for (const row of rows) {
    db.insert(files)
      .values(row)
      .onConflictDoUpdate({
        target: files.driveFileId,
        set: {
          companyId: row.companyId,
          monthKey: row.monthKey,
          folderSlot: row.folderSlot,
          parentId: row.parentId,
          name: row.name,
          mimeType: row.mimeType,
          driveCreatedTime: row.driveCreatedTime,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          deleted: row.deleted,
        },
      })
      .run();
  }
}

export function listFilesForMonth(
  companyId: number,
  monthKey: string,
): PersistedFileRow[] {
  const db = getDb();
  return db
    .select()
    .from(files)
    .where(and(eq(files.companyId, companyId), eq(files.monthKey, monthKey)))
    .all();
}

export function getFileByDriveId(driveFileId: string): PersistedFileRow | undefined {
  const db = getDb();
  return db.select().from(files).where(eq(files.driveFileId, driveFileId)).get();
}
