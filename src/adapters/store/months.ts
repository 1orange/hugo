import { and, eq, isNotNull } from "drizzle-orm";
import { months } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { monthKeyAt, selectOpenMonthKey } from "@/modules/month-lifecycle";

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

/** Every month of every company: what the background reading window plans over. */
export async function listAllMonths(): Promise<MonthRow[]> {
  const db = getDb();
  return db.select().from(months);
}

export async function listMonthsForCompany(companyId: number): Promise<MonthRow[]> {
  const db = getDb();
  const rows = await db.select().from(months).where(eq(months.companyId, companyId));
  return rows.sort((left, right) => left.monthKey.localeCompare(right.monthKey));
}

/**
 * The open month on the office clock. Future months are pre-created by the
 * office and never open (ADR 0005, amended 2026-11-11).
 */
export async function getOpenMonthKey(
  companyId: number,
  currentMonthKey: string = monthKeyAt(new Date()),
): Promise<string | null> {
  return selectOpenMonthKey(await listMonthsForCompany(companyId), currentMonthKey);
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

/** Every closed month, of one company or all: what late arrivals are judged against. */
export async function listClosedMonths(companyId?: number): Promise<MonthRow[]> {
  const db = getDb();
  const closed = isNotNull(months.closedAt);
  return db
    .select()
    .from(months)
    .where(companyId === undefined ? closed : and(closed, eq(months.companyId, companyId)));
}
