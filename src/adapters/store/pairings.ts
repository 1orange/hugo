import { and, eq, isNull } from "drizzle-orm";
import { pairings } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";

export type PairingRow = {
  id: number;
  paymentId: number;
  proofDriveFileId: string;
  createdBy: "auto" | "manual";
  confidence: string | null;
  reason: string | null;
  createdAt: string;
  unpairedAt: string | null;
};

export type NewPairing = {
  paymentId: number;
  proofDriveFileId: string;
  createdBy: "auto" | "manual";
  confidence?: string | null;
  reason?: string | null;
  createdAt: string;
};

export function listActivePairingsForMonth(
  companyId: number,
  monthKey: string,
  paymentIds: number[],
): PairingRow[] {
  if (paymentIds.length === 0) {
    return [];
  }

  const db = getDb();
  const rows = db
    .select()
    .from(pairings)
    .where(isNull(pairings.unpairedAt))
    .all();

  const paymentIdSet = new Set(paymentIds);
  return rows.filter((row) => paymentIdSet.has(row.paymentId)) as PairingRow[];
}

export function listAllPairingsForPayments(paymentIds: number[]): PairingRow[] {
  if (paymentIds.length === 0) {
    return [];
  }

  const db = getDb();
  const paymentIdSet = new Set(paymentIds);
  return db
    .select()
    .from(pairings)
    .all()
    .filter((row) => paymentIdSet.has(row.paymentId)) as PairingRow[];
}

export function getActivePairing(
  paymentId: number,
  proofDriveFileId: string,
): PairingRow | undefined {
  const db = getDb();
  return db
    .select()
    .from(pairings)
    .where(
      and(
        eq(pairings.paymentId, paymentId),
        eq(pairings.proofDriveFileId, proofDriveFileId),
        isNull(pairings.unpairedAt),
      ),
    )
    .get() as PairingRow | undefined;
}

export function createPairing(input: NewPairing): PairingRow {
  const db = getDb();
  const result = db
    .insert(pairings)
    .values({
      paymentId: input.paymentId,
      proofDriveFileId: input.proofDriveFileId,
      createdBy: input.createdBy,
      confidence: input.confidence ?? null,
      reason: input.reason ?? null,
      createdAt: input.createdAt,
      unpairedAt: null,
    })
    .run();
  const row = db
    .select()
    .from(pairings)
    .where(eq(pairings.id, Number(result.lastInsertRowid)))
    .get();
  return row as PairingRow;
}

export function unpairPairing(
  pairingId: number,
  unpairedAt: string,
): PairingRow | undefined {
  const db = getDb();
  db.update(pairings)
    .set({ unpairedAt })
    .where(and(eq(pairings.id, pairingId), isNull(pairings.unpairedAt)))
    .run();
  return db.select().from(pairings).where(eq(pairings.id, pairingId)).get() as
    | PairingRow
    | undefined;
}

export function getPairingById(pairingId: number): PairingRow | undefined {
  const db = getDb();
  return db.select().from(pairings).where(eq(pairings.id, pairingId)).get() as
    | PairingRow
    | undefined;
}
