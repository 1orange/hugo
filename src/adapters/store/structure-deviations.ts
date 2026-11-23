import { asc, count, eq, inArray } from "drizzle-orm";
import { structureDeviations } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { CompanyLayout } from "@/modules/company-layout";
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
  layout: CompanyLayout | null;
};

type DeviationValues = typeof structureDeviations.$inferInsert;

/** What a deviation row says about Drive, without when it was found. */
function valuesOf({ companyId, deviation }: StructureDeviationInsert): Omit<DeviationValues, "detectedAt"> {
  const details: StoredDetails = {
    observedName: deviation.observedName,
    expectedName: deviation.expectedName,
    repair: deviation.repair,
    layout: deviation.layout,
  };
  return {
    companyId,
    kind: deviation.kind,
    severity: deviation.severity,
    path: deviation.path,
    monthKey: deviation.monthKey,
    driveFolderId: deviation.folderId,
    detailsJson: JSON.stringify(details),
  };
}

function sameFinding(row: DeviationValues, values: Omit<DeviationValues, "detectedAt">): boolean {
  return (
    row.companyId === values.companyId &&
    row.kind === values.kind &&
    row.severity === values.severity &&
    row.path === values.path &&
    (row.monthKey ?? null) === (values.monthKey ?? null) &&
    (row.driveFolderId ?? null) === (values.driveFolderId ?? null) &&
    row.detailsJson === values.detailsJson
  );
}

/**
 * Brings the stored deviations in line with what the sweep just found. A finding
 * stored already keeps its row and its detectedAt, so a sweep over unchanged
 * Drive writes nothing (ADR 0003); the rest are inserted and the rows nothing
 * found again are deleted. Both share a transaction, so a page reading in
 * between saw either the old picture or the new one. Each sweep covers every
 * company in Drive, so a company that has left Drive loses its rows too.
 */
export async function replaceStructureDeviations(
  rows: StructureDeviationInsert[],
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const stored = await tx.select().from(structureDeviations);
    const keptIds = new Set<number>();
    const unmatched = [...stored];
    const inserts: DeviationValues[] = [];

    for (const row of rows) {
      const values = valuesOf(row);
      const index = unmatched.findIndex((candidate) => sameFinding(candidate, values));
      if (index === -1) {
        inserts.push({ ...values, detectedAt: row.detectedAt });
        continue;
      }
      keptIds.add(unmatched[index]!.id);
      unmatched.splice(index, 1);
    }

    const staleIds = stored.filter((row) => !keptIds.has(row.id)).map((row) => row.id);
    if (staleIds.length > 0) {
      await tx.delete(structureDeviations).where(inArray(structureDeviations.id, staleIds));
    }
    if (inserts.length > 0) {
      await tx.insert(structureDeviations).values(inserts);
    }
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
      layout: details.layout ?? null,
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
