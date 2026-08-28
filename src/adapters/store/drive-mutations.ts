import { and, eq, isNull } from "drizzle-orm";
import { driveMutations } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
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
export function insertPendingMutation(row: {
  kind: MutationKind;
  driveFileId: string;
  companyId: number;
  previousParent: string;
  previousName: string;
  newParent: string;
  newName: string;
  intendedAt: string;
}): DriveMutationRow {
  const db = getDb();
  return hydrate(
    db
      .insert(driveMutations)
      .values({ ...row, status: "pending" })
      .returning()
      .get(),
  );
}

export function markMutationApplied(
  mutationId: number,
  appliedAt: string,
): DriveMutationRow | null {
  const db = getDb();
  const updated = db
    .update(driveMutations)
    .set({ status: "applied", appliedAt })
    .where(eq(driveMutations.id, mutationId))
    .returning()
    .get();
  return updated ? hydrate(updated) : null;
}

export function markMutationFailed(
  mutationId: number,
  failureMessage: string,
): DriveMutationRow | null {
  const db = getDb();
  const updated = db
    .update(driveMutations)
    .set({ status: "failed", failureMessage })
    .where(eq(driveMutations.id, mutationId))
    .returning()
    .get();
  return updated ? hydrate(updated) : null;
}

export function markMutationUndone(
  mutationId: number,
  undoneAt: string,
): DriveMutationRow | null {
  const db = getDb();
  const existing = db
    .select()
    .from(driveMutations)
    .where(eq(driveMutations.id, mutationId))
    .get();
  if (!existing || existing.undoneAt) {
    return null;
  }

  db.update(driveMutations)
    .set({ undoneAt })
    .where(eq(driveMutations.id, mutationId))
    .run();

  return hydrate({ ...existing, undoneAt });
}

/**
 * The mutation a folder can currently be reverted to. Pending and failed rows
 * are excluded: their effect on Drive is unconfirmed, so offering undo would be
 * a guess.
 */
export function getActiveMutationForFolder(
  driveFileId: string,
): DriveMutationRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(driveMutations)
    .where(
      and(
        eq(driveMutations.driveFileId, driveFileId),
        eq(driveMutations.status, "applied"),
        isNull(driveMutations.undoneAt),
      ),
    )
    .get();
  return row ? hydrate(row) : null;
}

export function listUnresolvedMutations(): DriveMutationRow[] {
  const db = getDb();
  return db
    .select()
    .from(driveMutations)
    .where(eq(driveMutations.status, "pending"))
    .all()
    .map(hydrate);
}

export function getMutationById(mutationId: number): DriveMutationRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(driveMutations)
    .where(eq(driveMutations.id, mutationId))
    .get();
  return row ? hydrate(row) : null;
}
