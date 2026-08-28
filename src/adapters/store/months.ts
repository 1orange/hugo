import { and, eq } from "drizzle-orm";
import { months } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";

export type MonthRow = {
  id: number;
  companyId: number;
  monthKey: string;
  driveFolderId: string;
  closedAt: string | null;
  openedAt: string | null;
};

export function upsertMonth(
  companyId: number,
  monthKey: string,
  driveFolderId: string,
): MonthRow {
  const db = getDb();
  const existing = db
    .select()
    .from(months)
    .where(
      and(eq(months.companyId, companyId), eq(months.monthKey, monthKey)),
    )
    .get();

  if (existing) {
    if (existing.driveFolderId !== driveFolderId) {
      db.update(months)
        .set({ driveFolderId })
        .where(eq(months.id, existing.id))
        .run();
    }
    return { ...existing, driveFolderId };
  }

  return db
    .insert(months)
    .values({ companyId, monthKey, driveFolderId })
    .returning()
    .get();
}

export function listMonthsForCompany(companyId: number): MonthRow[] {
  const db = getDb();
  return db
    .select()
    .from(months)
    .where(eq(months.companyId, companyId))
    .all()
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey));
}

export function getOpenMonthKey(companyId: number): string | null {
  const monthRows = listMonthsForCompany(companyId).filter(
    (month) => month.closedAt === null,
  );
  if (monthRows.length === 0) {
    return null;
  }
  return monthRows[monthRows.length - 1]!.monthKey;
}
