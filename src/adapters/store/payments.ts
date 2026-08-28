import { and, eq, isNull, sql } from "drizzle-orm";
import { payments, receiptDecodeJobs, receiptManualQueue } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";

export type PaymentRow = {
  id: number;
  companyId: number;
  monthKey: string;
  source: string;
  blocekFileId: string;
  amountCents: number | null;
  amountLiteral: string | null;
  currency: string;
  receiptAt: string | null;
  receiptTimestampRaw: string | null;
  ekasaUid: string | null;
  ekasaPayload: string | null;
  decodeStatus: string;
  confirmedAt: string | null;
  createdAt: string;
};

export type NewCashPayment = {
  companyId: number;
  monthKey: string;
  blocekFileId: string;
  amountCents: number | null;
  amountLiteral: string | null;
  currency?: string;
  receiptAt: string | null;
  receiptTimestampRaw: string | null;
  ekasaUid: string | null;
  ekasaPayload: string | null;
  decodeStatus: "complete" | "manual" | "pending";
  createdAt: string;
};

export type ManualQueueRow = {
  driveFileId: string;
  companyId: number;
  monthKey: string;
  reason: string;
  createdAt: string;
};

export function getPaymentByBlocekFileId(
  blocekFileId: string,
): PaymentRow | undefined {
  const db = getDb();
  return db
    .select()
    .from(payments)
    .where(eq(payments.blocekFileId, blocekFileId))
    .get();
}

export function listCashPaymentsForMonth(
  companyId: number,
  monthKey: string,
): PaymentRow[] {
  const db = getDb();
  return db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.companyId, companyId),
        eq(payments.monthKey, monthKey),
        eq(payments.source, "cash"),
      ),
    )
    .all();
}

export function countUntickedPayments(companyId: number, monthKey: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(payments)
    .where(
      and(
        eq(payments.companyId, companyId),
        eq(payments.monthKey, monthKey),
        isNull(payments.confirmedAt),
      ),
    )
    .get();
  return row?.count ?? 0;
}

export function companyHasPayments(companyId: number): boolean {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(payments)
    .where(eq(payments.companyId, companyId))
    .get();
  return (row?.count ?? 0) > 0;
}

export function upsertCashPayment(input: NewCashPayment): PaymentRow {
  const db = getDb();
  db.insert(payments)
    .values({
      companyId: input.companyId,
      monthKey: input.monthKey,
      source: "cash",
      blocekFileId: input.blocekFileId,
      amountCents: input.amountCents,
      amountLiteral: input.amountLiteral,
      currency: input.currency ?? "EUR",
      receiptAt: input.receiptAt,
      receiptTimestampRaw: input.receiptTimestampRaw,
      ekasaUid: input.ekasaUid,
      ekasaPayload: input.ekasaPayload,
      decodeStatus: input.decodeStatus,
      createdAt: input.createdAt,
    })
    .onConflictDoUpdate({
      target: payments.blocekFileId,
      set: {
        amountCents: input.amountCents,
        amountLiteral: input.amountLiteral,
        receiptAt: input.receiptAt,
        receiptTimestampRaw: input.receiptTimestampRaw,
        ekasaUid: input.ekasaUid,
        ekasaPayload: input.ekasaPayload,
        decodeStatus: input.decodeStatus,
      },
    })
    .run();

  return getPaymentByBlocekFileId(input.blocekFileId)!;
}

export function listManualQueueForMonth(
  companyId: number,
  monthKey: string,
): ManualQueueRow[] {
  const db = getDb();
  return db
    .select()
    .from(receiptManualQueue)
    .where(
      and(
        eq(receiptManualQueue.companyId, companyId),
        eq(receiptManualQueue.monthKey, monthKey),
      ),
    )
    .all();
}

export function upsertManualQueueEntry(entry: ManualQueueRow): void {
  const db = getDb();
  db.insert(receiptManualQueue)
    .values(entry)
    .onConflictDoUpdate({
      target: receiptManualQueue.driveFileId,
      set: {
        reason: entry.reason,
        createdAt: entry.createdAt,
      },
    })
    .run();
}

export function getManualQueueEntry(
  driveFileId: string,
): ManualQueueRow | undefined {
  const db = getDb();
  return db
    .select()
    .from(receiptManualQueue)
    .where(eq(receiptManualQueue.driveFileId, driveFileId))
    .get();
}

export function setDecodeJobStatus(
  driveFileId: string,
  companyId: number,
  monthKey: string,
  status: "pending" | "done" | "failed",
  failureReason: string | null,
  updatedAt: string,
): void {
  const db = getDb();
  db.insert(receiptDecodeJobs)
    .values({
      driveFileId,
      companyId,
      monthKey,
      status,
      failureReason,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: receiptDecodeJobs.driveFileId,
      set: {
        status,
        failureReason,
        updatedAt,
      },
    })
    .run();
}

export function getDecodeJob(
  driveFileId: string,
): {
  driveFileId: string;
  companyId: number;
  monthKey: string;
  status: string;
  failureReason: string | null;
  updatedAt: string;
} | undefined {
  const db = getDb();
  return db
    .select()
    .from(receiptDecodeJobs)
    .where(eq(receiptDecodeJobs.driveFileId, driveFileId))
    .get();
}

export function listPendingDecodeJobsForMonth(
  companyId: number,
  monthKey: string,
): Array<{
  driveFileId: string;
  status: string;
  failureReason: string | null;
}> {
  const db = getDb();
  return db
    .select({
      driveFileId: receiptDecodeJobs.driveFileId,
      status: receiptDecodeJobs.status,
      failureReason: receiptDecodeJobs.failureReason,
    })
    .from(receiptDecodeJobs)
    .where(
      and(
        eq(receiptDecodeJobs.companyId, companyId),
        eq(receiptDecodeJobs.monthKey, monthKey),
        eq(receiptDecodeJobs.status, "pending"),
      ),
    )
    .all();
}
