import { eq, inArray, sql } from "drizzle-orm";
import { driveItems } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { DriveFileRecord } from "@/modules/drive-tree";

/** Rows per statement: well under Postgres's 65,535 bound parameters. */
const CHUNK = 1000;

type DriveItemRow = typeof driveItems.$inferInsert;

function toRow(file: DriveFileRecord): DriveItemRow {
  return {
    id: file.id,
    name: file.name,
    parentsJson: JSON.stringify(file.parents),
    createdTime: file.createdTime,
    mimeType: file.mimeType,
    canRename: file.capabilities?.canRename ?? null,
    canMove: file.capabilities?.canMoveItemWithinDrive ?? null,
  };
}

function toRecord(row: typeof driveItems.$inferSelect): DriveFileRecord {
  return {
    id: row.id,
    name: row.name,
    parents: JSON.parse(row.parentsJson) as string[],
    createdTime: row.createdTime,
    mimeType: row.mimeType,
    capabilities:
      row.canRename === null && row.canMove === null
        ? undefined
        : { canRename: row.canRename ?? true, canMoveItemWithinDrive: row.canMove ?? true },
  };
}

export async function listDriveItems(): Promise<DriveFileRecord[]> {
  return (await getDb().select().from(driveItems)).map(toRecord);
}

async function upsertRows(rows: DriveItemRow[]): Promise<void> {
  const db = getDb();
  for (let index = 0; index < rows.length; index += CHUNK) {
    await db
      .insert(driveItems)
      .values(rows.slice(index, index + CHUNK))
      .onConflictDoUpdate({
        target: driveItems.id,
        set: {
          name: sql`excluded.name`,
          parentsJson: sql`excluded.parents_json`,
          createdTime: sql`excluded.created_time`,
          mimeType: sql`excluded.mime_type`,
          canRename: sql`excluded.can_rename`,
          canMove: sql`excluded.can_move`,
        },
      });
  }
}

/** A full listing replaces the snapshot. */
export async function replaceDriveItems(files: DriveFileRecord[]): Promise<void> {
  await getDb().delete(driveItems);
  await upsertRows(files.map(toRow));
}

/** Drive's changes since the last sweep, applied to the snapshot. */
export async function applyDriveItemChanges(input: { upserts: DriveFileRecord[]; removedIds: string[] }): Promise<void> {
  const db = getDb();
  for (let index = 0; index < input.removedIds.length; index += CHUNK) {
    await db.delete(driveItems).where(inArray(driveItems.id, input.removedIds.slice(index, index + CHUNK)));
  }
  await upsertRows(input.upserts.map(toRow));
}

/**
 * What this app just did in Drive, written through to the snapshot, so the
 * sweep that follows shows it even before Drive's change log does.
 */
export async function recordDriveRename(id: string, name: string): Promise<void> {
  await getDb().update(driveItems).set({ name }).where(eq(driveItems.id, id));
}

export async function recordDriveMove(id: string, fromParentId: string, toParentId: string): Promise<void> {
  const [row] = await getDb().select().from(driveItems).where(eq(driveItems.id, id)).limit(1);
  if (!row) {
    return;
  }
  const parents = (JSON.parse(row.parentsJson) as string[]).map((parent) =>
    parent === fromParentId ? toParentId : parent,
  );
  await getDb().update(driveItems).set({ parentsJson: JSON.stringify(parents) }).where(eq(driveItems.id, id));
}
