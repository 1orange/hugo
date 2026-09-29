import { and, eq } from "drizzle-orm";
import { monthFolders } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";

export type MonthFolderRow = {
  driveFolderId: string;
  companyId: number;
  monthKey: string;
  name: string;
  parentId: string;
  canRename: boolean;
};

export async function replaceMonthFoldersForCompany(
  companyId: number,
  rows: MonthFolderRow[],
): Promise<void> {
  const db = getDb();
  // Delete and insert together: a page reading in between saw no folders.
  await db.transaction(async (tx) => {
    await tx.delete(monthFolders).where(eq(monthFolders.companyId, companyId));
    for (const row of rows) {
      await tx
        .insert(monthFolders)
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
        });
    }
  });
}

export async function getMonthFolder(driveFolderId: string): Promise<MonthFolderRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(monthFolders)
    .where(eq(monthFolders.driveFolderId, driveFolderId))
    .limit(1);
  return row ?? null;
}

export async function listMonthFolders(
  companyId: number,
  monthKey: string,
): Promise<MonthFolderRow[]> {
  const db = getDb();
  return db
    .select()
    .from(monthFolders)
    .where(and(eq(monthFolders.companyId, companyId), eq(monthFolders.monthKey, monthKey)));
}

export async function listAllMonthFolders(): Promise<MonthFolderRow[]> {
  const db = getDb();
  return db.select().from(monthFolders);
}
