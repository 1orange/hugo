import { and, eq, sql } from "drizzle-orm";
import { companies, files } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
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
  /** Moved here from another month at; null when here since first seen. */
  arrivedAt?: string | null;
  canMove?: boolean;
  deleted: boolean;
};

export async function listStoredFilesForSweep(): Promise<StoredFileState[]> {
  const db = getDb();
  return db
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
      arrivedAt: files.arrivedAt,
      canMove: files.canMove,
      deleted: files.deleted,
    })
    .from(files)
    .innerJoin(companies, eq(files.companyId, companies.id));
}

/** Rows per statement: well under Postgres's 65,535 bound parameters. */
const UPSERT_CHUNK = 500;

export async function upsertFiles(rows: PersistedFileRow[]): Promise<void> {
  const db = getDb();
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK) {
    await db
      .insert(files)
      .values(
        rows.slice(index, index + UPSERT_CHUNK).map((row) => ({
          ...row,
          arrivedAt: row.arrivedAt ?? null,
          canMove: row.canMove ?? true,
        })),
      )
      .onConflictDoUpdate({
        target: files.driveFileId,
        set: {
          companyId: sql`excluded.company_id`,
          monthKey: sql`excluded.month_key`,
          folderSlot: sql`excluded.folder_slot`,
          parentId: sql`excluded.parent_id`,
          name: sql`excluded.name`,
          mimeType: sql`excluded.mime_type`,
          driveCreatedTime: sql`excluded.drive_created_time`,
          firstSeenAt: sql`excluded.first_seen_at`,
          lastSeenAt: sql`excluded.last_seen_at`,
          arrivedAt: sql`excluded.arrived_at`,
          canMove: sql`excluded.can_move`,
          deleted: sql`excluded.deleted`,
        },
      });
  }
}

export async function listFilesForMonth(
  companyId: number,
  monthKey: string,
): Promise<PersistedFileRow[]> {
  const db = getDb();
  return db
    .select()
    .from(files)
    .where(and(eq(files.companyId, companyId), eq(files.monthKey, monthKey)));
}

export async function getFileByDriveId(driveFileId: string): Promise<PersistedFileRow | undefined> {
  const db = getDb();
  const [row] = await db.select().from(files).where(eq(files.driveFileId, driveFileId)).limit(1);
  return row;
}

/** The stored files of one company, or of all. */
export async function listFiles(companyId?: number): Promise<PersistedFileRow[]> {
  const db = getDb();
  const query = db.select().from(files);
  return companyId === undefined ? query : query.where(eq(files.companyId, companyId));
}
