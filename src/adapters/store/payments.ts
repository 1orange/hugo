import { and, eq, isNull, sql } from "drizzle-orm";
import {
  paymentLineItems,
  paymentVatRecap,
  payments,
  receiptDecodeJobs,
  receiptManualQueue,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";

export type PaymentLineItemRow = {
  id: number;
  paymentId: number;
  sortOrder: number;
  name: string;
  vatRateLiteral: string;
  quantityLiteral: string;
  unitPriceLiteral: string;
  lineTotalLiteral: string;
  lineTotalCents: number;
};

export type PaymentVatRecapRow = {
  id: number;
  paymentId: number;
  rateLiteral: string;
  baseLiteral: string;
  baseCents: number;
  vatLiteral: string;
  vatCents: number;
};

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
  ekasaOkp: string | null;
  supplierName: string | null;
  dic: string | null;
  ico: string | null;
  icDph: string | null;
  kp: string | null;
  receiptNumber: string | null;
  recapBaseCents: number | null;
  recapBaseLiteral: string | null;
  recapVatCents: number | null;
  recapVatLiteral: string | null;
  decodeStatus: string;
  confirmedAt: string | null;
  createdAt: string;
};

export type NewCashPaymentLineItem = {
  sortOrder: number;
  name: string;
  vatRateLiteral: string;
  quantityLiteral: string;
  unitPriceLiteral: string;
  lineTotalLiteral: string;
  lineTotalCents: number;
};

export type NewCashPaymentVatRecap = {
  rateLiteral: string;
  baseLiteral: string;
  baseCents: number;
  vatLiteral: string;
  vatCents: number;
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
  ekasaOkp: string | null;
  supplierName: string | null;
  dic: string | null;
  ico: string | null;
  icDph: string | null;
  kp: string | null;
  receiptNumber: string | null;
  recapBaseCents: number | null;
  recapBaseLiteral: string | null;
  recapVatCents: number | null;
  recapVatLiteral: string | null;
  decodeStatus: "complete" | "manual" | "pending";
  lineItems?: NewCashPaymentLineItem[];
  vatRecap?: NewCashPaymentVatRecap[];
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

function replacePaymentLineItems(
  paymentId: number,
  lineItems: NewCashPaymentLineItem[],
): void {
  const db = getDb();
  db.delete(paymentLineItems)
    .where(eq(paymentLineItems.paymentId, paymentId))
    .run();
  for (const item of lineItems) {
    db.insert(paymentLineItems)
      .values({
        paymentId,
        sortOrder: item.sortOrder,
        name: item.name,
        vatRateLiteral: item.vatRateLiteral,
        quantityLiteral: item.quantityLiteral,
        unitPriceLiteral: item.unitPriceLiteral,
        lineTotalLiteral: item.lineTotalLiteral,
        lineTotalCents: item.lineTotalCents,
      })
      .run();
  }
}

function replacePaymentVatRecap(
  paymentId: number,
  rows: NewCashPaymentVatRecap[],
): void {
  const db = getDb();
  db.delete(paymentVatRecap)
    .where(eq(paymentVatRecap.paymentId, paymentId))
    .run();
  for (const row of rows) {
    db.insert(paymentVatRecap)
      .values({
        paymentId,
        rateLiteral: row.rateLiteral,
        baseLiteral: row.baseLiteral,
        baseCents: row.baseCents,
        vatLiteral: row.vatLiteral,
        vatCents: row.vatCents,
      })
      .run();
  }
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
      ekasaOkp: input.ekasaOkp,
      supplierName: input.supplierName,
      dic: input.dic,
      ico: input.ico,
      icDph: input.icDph,
      kp: input.kp,
      receiptNumber: input.receiptNumber,
      recapBaseCents: input.recapBaseCents,
      recapBaseLiteral: input.recapBaseLiteral,
      recapVatCents: input.recapVatCents,
      recapVatLiteral: input.recapVatLiteral,
      decodeStatus: input.decodeStatus,
      createdAt: input.createdAt,
    })
    .onConflictDoUpdate({
      target: payments.blocekFileId,
      set: {
        amountCents: input.amountCents,
        amountLiteral: input.amountLiteral,
        currency: input.currency ?? "EUR",
        receiptAt: input.receiptAt,
        receiptTimestampRaw: input.receiptTimestampRaw,
        ekasaUid: input.ekasaUid,
        ekasaOkp: input.ekasaOkp,
        supplierName: input.supplierName,
        dic: input.dic,
        ico: input.ico,
        icDph: input.icDph,
        kp: input.kp,
        receiptNumber: input.receiptNumber,
        recapBaseCents: input.recapBaseCents,
        recapBaseLiteral: input.recapBaseLiteral,
        recapVatCents: input.recapVatCents,
        recapVatLiteral: input.recapVatLiteral,
        decodeStatus: input.decodeStatus,
      },
    })
    .run();

  const payment = getPaymentByBlocekFileId(input.blocekFileId)!;
  if (input.lineItems) {
    replacePaymentLineItems(payment.id, input.lineItems);
  }
  if (input.vatRecap) {
    replacePaymentVatRecap(payment.id, input.vatRecap);
  }
  return payment;
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
