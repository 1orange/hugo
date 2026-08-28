import { and, eq } from "drizzle-orm";
import { monthFolders } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";

export type MonthFolderRow = {
  driveFolderId: string;
  companyId: number;
  monthKey: string;
  name: string;
  parentId: string;
  canRename: boolean;
};

export function replaceMonthFoldersForCompany(
  companyId: number,
  rows: MonthFolderRow[],
): void {
  const db = getDb();
  db.delete(monthFolders)
    .where(eq(monthFolders.companyId, companyId))
    .run();

  for (const row of rows) {
    db.insert(monthFolders)
      .values(row)
      .onConflictDoUpdate({
        target: monthFolders.driveFolderId,
        set: {
          companyId: row.companyId,
          monthKey: row.monthKey,
          name: row.name,
          parentId: row.parentId,
          canRename: row.canRename,
        },
      })
      .run();
  }
}

export function getMonthFolder(driveFolderId: string): MonthFolderRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(monthFolders)
    .where(eq(monthFolders.driveFolderId, driveFolderId))
    .get();
  return row ?? null;
}

export function listMonthFolders(
  companyId: number,
  monthKey: string,
): MonthFolderRow[] {
  const db = getDb();
  return db
    .select()
    .from(monthFolders)
    .where(
      and(
        eq(monthFolders.companyId, companyId),
        eq(monthFolders.monthKey, monthKey),
      ),
    )
    .all();
}

export function listAllMonthFolders(): MonthFolderRow[] {
  const db = getDb();
  return db.select().from(monthFolders).all();
}
