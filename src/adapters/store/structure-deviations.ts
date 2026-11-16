import { asc, count, eq } from "drizzle-orm";
import { structureDeviations } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type {
  StructureDeviation,
  StructureDeviationKind,
  StructureSeverity,
} from "@/modules/drive-structure";

export type StructureDeviationInsert = {
  companyId: number;
  deviation: StructureDeviation;
  detectedAt: string;
};

/** The kind-specific fields that have no column of their own. */
type StoredDetails = {
  observedName: string | null;
  expectedName: string | null;
  repair: { targetName: string } | null;
};

/**
 * Replaces every stored deviation with what the sweep just found. Delete and
 * insert share a transaction, so a page reading in between saw either the old
 * picture or the new one. Each sweep covers every company in Drive, so a
 * company that has left Drive loses its rows too.
 */
export async function replaceStructureDeviations(
  rows: StructureDeviationInsert[],
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(structureDeviations);
    if (rows.length === 0) {
      return;
    }
    await tx.insert(structureDeviations).values(
      rows.map(({ companyId, deviation, detectedAt }) => {
        const details: StoredDetails = {
          observedName: deviation.observedName,
          expectedName: deviation.expectedName,
          repair: deviation.repair,
        };
        return {
          companyId,
          kind: deviation.kind,
          severity: deviation.severity,
          path: deviation.path,
          monthKey: deviation.monthKey,
          driveFolderId: deviation.folderId,
          detailsJson: JSON.stringify(details),
          detectedAt,
        };
      }),
    );
  });
}

export async function listStructureDeviationsForCompany(
  companyId: number,
): Promise<StructureDeviation[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(structureDeviations)
    .where(eq(structureDeviations.companyId, companyId))
    .orderBy(asc(structureDeviations.monthKey), asc(structureDeviations.id));

  return rows.map((row) => {
    const details = JSON.parse(row.detailsJson) as StoredDetails;
    return {
      kind: row.kind as StructureDeviationKind,
      severity: row.severity as StructureSeverity,
      path: row.path,
      monthKey: row.monthKey,
      folderId: row.driveFolderId,
      observedName: details.observedName,
      expectedName: details.expectedName,
      repair: details.repair,
    };
  });
}

/** Deviation count per company, for the rows of the companies list. */
export async function countStructureDeviationsByCompany(): Promise<Map<number, number>> {
  const db = getDb();
  const rows = await db
    .select({ companyId: structureDeviations.companyId, total: count() })
    .from(structureDeviations)
    .groupBy(structureDeviations.companyId);
  return new Map(rows.map((row) => [row.companyId, Number(row.total)]));
}
