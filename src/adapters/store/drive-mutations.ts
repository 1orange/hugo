import { and, eq, isNull } from "drizzle-orm";
import { driveMutations } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { MutationKind } from "@/modules/drive-mutation";

export type MutationStatus = "pending" | "applied" | "failed";

export type DriveMutationRow = {
  id: number;
  kind: MutationKind;
  driveFileId: string;
  companyId: number;
  previousParent: string;
  previousName: string;
  newParent: string;
  newName: string;
  status: MutationStatus;
  intendedAt: string;
  appliedAt: string | null;
  failureMessage: string | null;
  undoneAt: string | null;
};

function hydrate(row: typeof driveMutations.$inferSelect): DriveMutationRow {
  return {
    ...row,
    kind: row.kind as MutationKind,
    status: row.status as MutationStatus,
  };
}

/**
 * Records the intent to mutate Drive. Called before the Drive call so that an
 * interrupted mutation is still reversible; the row is only marked applied once
 * Drive has confirmed.
 */
export async function insertPendingMutation(row: {
  kind: MutationKind;
  driveFileId: string;
  companyId: number;
  previousParent: string;
  previousName: string;
  newParent: string;
  newName: string;
  intendedAt: string;
}): Promise<DriveMutationRow> {
  const db = getDb();
  const [inserted] = await db
    .insert(driveMutations)
    .values({ ...row, status: "pending" })
    .returning();
  return hydrate(inserted!);
}

export async function markMutationApplied(
  mutationId: number,
  appliedAt: string,
): Promise<DriveMutationRow | null> {
  const db = getDb();
  const [updated] = await db
    .update(driveMutations)
    .set({ status: "applied", appliedAt })
    .where(eq(driveMutations.id, mutationId))
    .returning();
  return updated ? hydrate(updated) : null;
}

export async function markMutationFailed(
  mutationId: number,
  failureMessage: string,
): Promise<DriveMutationRow | null> {
  const db = getDb();
  const [updated] = await db
    .update(driveMutations)
    .set({ status: "failed", failureMessage })
    .where(eq(driveMutations.id, mutationId))
    .returning();
  return updated ? hydrate(updated) : null;
}

export async function markMutationUndone(
  mutationId: number,
  undoneAt: string,
): Promise<DriveMutationRow | null> {
  const db = getDb();
  // Only a row not yet undone: two replicas undoing at once, one wins.
  const [updated] = await db
    .update(driveMutations)
    .set({ undoneAt })
    .where(and(eq(driveMutations.id, mutationId), isNull(driveMutations.undoneAt)))
    .returning();
  return updated ? hydrate(updated) : null;
}

/**
 * The mutation a folder can currently be reverted to. Pending and failed rows
 * are excluded: their effect on Drive is unconfirmed, so offering undo would be
 * a guess.
 */
export async function getActiveMutationForFolder(
  driveFileId: string,
): Promise<DriveMutationRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(driveMutations)
    .where(
      and(
        eq(driveMutations.driveFileId, driveFileId),
        eq(driveMutations.status, "applied"),
        isNull(driveMutations.undoneAt),
      ),
    )
    .limit(1);
  return row ? hydrate(row) : null;
}

export async function listUnresolvedMutations(): Promise<DriveMutationRow[]> {
  const db = getDb();
  const rows = await db.select().from(driveMutations).where(eq(driveMutations.status, "pending"));
  return rows.map(hydrate);
}

export async function getMutationById(mutationId: number): Promise<DriveMutationRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(driveMutations)
    .where(eq(driveMutations.id, mutationId))
    .limit(1);
  return row ? hydrate(row) : null;
}
