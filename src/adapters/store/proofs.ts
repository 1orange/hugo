import { and, eq, isNull } from "drizzle-orm";
import { files, proofs } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import { isProofFolderSlot } from "@/modules/reconciliation";

export type ProofRow = {
  driveFileId: string;
  companyId: number;
  monthKey: string;
  note: string | null;
  createdAt: string;
};

export function ensureProofsForMonth(
  companyId: number,
  monthKey: string,
  createdAt: string,
): number {
  const db = getDb();
  const eligible = db
    .select({
      driveFileId: files.driveFileId,
      folderSlot: files.folderSlot,
    })
    .from(files)
    .where(
      and(
        eq(files.companyId, companyId),
        eq(files.monthKey, monthKey),
        eq(files.deleted, false),
      ),
    )
    .all()
    .filter((file) => isProofFolderSlot(file.folderSlot));

  let created = 0;
  for (const file of eligible) {
    const result = db
      .insert(proofs)
      .values({
        driveFileId: file.driveFileId,
        companyId,
        monthKey,
        createdAt,
      })
      .onConflictDoNothing()
      .run();
    if (result.changes > 0) {
      created += 1;
    }
  }
  return created;
}

export function listProofsForMonth(
  companyId: number,
  monthKey: string,
): ProofRow[] {
  const db = getDb();
  return db
    .select()
    .from(proofs)
    .where(and(eq(proofs.companyId, companyId), eq(proofs.monthKey, monthKey)))
    .all();
}

export function getProof(driveFileId: string): ProofRow | undefined {
  const db = getDb();
  return db.select().from(proofs).where(eq(proofs.driveFileId, driveFileId)).get();
}

export function updateProofNote(driveFileId: string, note: string | null): void {
  const db = getDb();
  db.update(proofs).set({ note }).where(eq(proofs.driveFileId, driveFileId)).run();
}
