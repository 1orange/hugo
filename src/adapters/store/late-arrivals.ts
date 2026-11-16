import { and, eq, inArray } from "drizzle-orm";
import { lateArrivals } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { DetectedLateArrival, LateArrivalStatus } from "@/modules/late-arrivals";

export type LateArrivalRow = {
  id: number;
  companyId: number;
  driveFileId: string;
  sourceMonthKey: string;
  folderSlot: string;
  sourceParentId: string;
  arrivedAt: string;
  detectedAt: string;
  status: LateArrivalStatus;
  statusChangedAt: string | null;
  targetMonthKey: string | null;
  mutationId: number | null;
};

function hydrate(row: typeof lateArrivals.$inferSelect): LateArrivalRow {
  return { ...row, status: row.status as LateArrivalStatus };
}

export async function listAllLateArrivals(): Promise<LateArrivalRow[]> {
  return (await getDb().select().from(lateArrivals)).map(hydrate);
}

export async function listLateArrivalsForCompany(companyId: number): Promise<LateArrivalRow[]> {
  const rows = await getDb().select().from(lateArrivals).where(eq(lateArrivals.companyId, companyId));
  return rows.map(hydrate).sort((left, right) => left.arrivedAt.localeCompare(right.arrivedAt) || left.id - right.id);
}

export async function getLateArrival(id: number): Promise<LateArrivalRow | null> {
  const [row] = await getDb().select().from(lateArrivals).where(eq(lateArrivals.id, id)).limit(1);
  return row ? hydrate(row) : null;
}

/** Logs a late file, or (re)opens its entry as pending with where the file is now. */
export async function upsertDetectedLateArrival(
  companyId: number,
  detected: DetectedLateArrival,
  now: string,
): Promise<void> {
  const place = {
    companyId,
    sourceMonthKey: detected.sourceMonthKey,
    folderSlot: detected.folderSlot,
    sourceParentId: detected.sourceParentId,
    arrivedAt: detected.arrivedAt,
  };
  await getDb()
    .insert(lateArrivals)
    .values({ ...place, driveFileId: detected.driveFileId, detectedAt: now, status: "pending" })
    .onConflictDoUpdate({
      target: lateArrivals.driveFileId,
      set: { ...place, status: "pending", statusChangedAt: now, targetMonthKey: null, mutationId: null },
    });
}

export async function resolveLateArrivals(ids: number[], now: string): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await getDb()
    .update(lateArrivals)
    .set({ status: "resolved", statusChangedAt: now })
    .where(and(inArray(lateArrivals.id, ids), eq(lateArrivals.status, "pending")));
}

export async function setLateArrivalStatus(
  id: number,
  status: LateArrivalStatus,
  now: string,
  move: { targetMonthKey: string | null; mutationId: number | null } = { targetMonthKey: null, mutationId: null },
): Promise<LateArrivalRow | null> {
  const [row] = await getDb()
    .update(lateArrivals)
    .set({ status, statusChangedAt: now, ...move })
    .where(eq(lateArrivals.id, id))
    .returning();
  return row ? hydrate(row) : null;
}
