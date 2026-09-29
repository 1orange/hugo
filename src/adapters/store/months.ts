import { and, eq } from "drizzle-orm";
import { months } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";

export type MonthRow = {
  id: number;
  companyId: number;
  monthKey: string;
  driveFolderId: string;
  closedAt: string | null;
  openedAt: string | null;
};

export async function upsertMonth(
  companyId: number,
  monthKey: string,
  driveFolderId: string,
): Promise<MonthRow> {
  const db = getDb();
  const existing = await getMonthByKey(companyId, monthKey);

  if (existing) {
    if (existing.driveFolderId !== driveFolderId) {
      await db.update(months).set({ driveFolderId }).where(eq(months.id, existing.id));
    }
    return { ...existing, driveFolderId };
  }

  // Another sweep may have added it meanwhile; its folder id is unique.
  const [inserted] = await db
    .insert(months)
    .values({ companyId, monthKey, driveFolderId })
    .onConflictDoNothing({ target: months.driveFolderId })
    .returning();
  return inserted ?? (await getMonthByKey(companyId, monthKey))!;
}

export async function listMonthsForCompany(companyId: number): Promise<MonthRow[]> {
  const db = getDb();
  const rows = await db.select().from(months).where(eq(months.companyId, companyId));
  return rows.sort((left, right) => left.monthKey.localeCompare(right.monthKey));
}

export async function getOpenMonthKey(companyId: number): Promise<string | null> {
  const monthRows = (await listMonthsForCompany(companyId)).filter(
    (month) => month.closedAt === null,
  );
  if (monthRows.length === 0) {
    return null;
  }
  return monthRows[monthRows.length - 1]!.monthKey;
}

export async function getMonthByKey(
  companyId: number,
  monthKey: string,
): Promise<MonthRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(months)
    .where(and(eq(months.companyId, companyId), eq(months.monthKey, monthKey)))
    .limit(1);
  return row ?? null;
}

export async function closeMonth(
  companyId: number,
  monthKey: string,
  closedAt: string,
): Promise<MonthRow | null> {
  const db = getDb();
  const [updated] = await db
    .update(months)
    .set({ closedAt })
    .where(and(eq(months.companyId, companyId), eq(months.monthKey, monthKey)))
    .returning();
  return updated ?? null;
}

export async function reopenMonth(
  companyId: number,
  monthKey: string,
): Promise<MonthRow | null> {
  const db = getDb();
  const [updated] = await db
    .update(months)
    .set({ closedAt: null })
    .where(and(eq(months.companyId, companyId), eq(months.monthKey, monthKey)))
    .returning();
  return updated ?? null;
}

export async function isMonthClosed(companyId: number, monthKey: string): Promise<boolean> {
  const month = await getMonthByKey(companyId, monthKey);
  return month?.closedAt !== null && month?.closedAt !== undefined;
}

export async function getMonthByDriveFolderId(
  driveFolderId: string,
): Promise<MonthRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(months)
    .where(eq(months.driveFolderId, driveFolderId))
    .limit(1);
  return row ?? null;
}
