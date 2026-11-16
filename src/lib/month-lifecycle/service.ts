import { appendUserEvent } from "@/adapters/store/events";
import {
  closeMonth as closeMonthRecord,
  getMonthByKey,
  reopenMonth as reopenMonthRecord,
} from "@/adapters/store/months";
import { syncLateArrivals } from "@/lib/late-arrivals/sync";

export type MonthActionResult =
  | { ok: true }
  | { ok: false; message: string };

export type MonthReadOnlyBlock = { ok: false; message: string };

export async function assertMonthEditable(
  companyId: number,
  monthKey: string,
): Promise<MonthReadOnlyBlock | null> {
  const month = await getMonthByKey(companyId, monthKey);
  if (!month) {
    return { ok: false, message: "Mesiac sa nenašiel." };
  }
  if (month.closedAt) {
    return {
      ok: false,
      message: "Tento mesiac je uzavretý a len na čítanie.",
    };
  }
  return null;
}

/**
 * Records the close and nothing else. The office owns the Drive structure
 * (ADR 0005, amended 2026-11-11): closing never creates next month's folders,
 * and a missing folder is reported by the structure view instead.
 */
export async function closeCompanyMonth(
  companyId: number,
  monthKey: string,
): Promise<MonthActionResult> {
  const editable = await assertMonthEditable(companyId, monthKey);
  if (editable) {
    return editable;
  }

  /*
   * Any month that is not already closed can be closed, not only the most
   * recent one. ADR 0005 anchors the lifecycle on the explicit click and
   * *derives* the open month as the newest unclosed month that has started
   * (ADR 0005, amended 2026-11-11); that derivation still holds when an older
   * month is closed out of order, which happens whenever a late month is
   * finished after a newer one was started.
   */
  const closedAt = new Date().toISOString();
  await closeMonthRecord(companyId, monthKey, closedAt);
  await appendUserEvent(closedAt, companyId, "MonthClosed", { monthKey });

  return { ok: true };
}

export async function reopenCompanyMonth(
  companyId: number,
  monthKey: string,
): Promise<MonthActionResult> {
  const month = await getMonthByKey(companyId, monthKey);
  if (!month) {
    return { ok: false, message: "Mesiac sa nenašiel." };
  }
  if (!month.closedAt) {
    return { ok: false, message: "Mesiac nie je uzavretý." };
  }

  const reopenedAt = new Date().toISOString();
  await reopenMonthRecord(companyId, monthKey);
  await appendUserEvent(reopenedAt, companyId, "MonthReopened", { monthKey });
  // What arrived late in it is late no more: it is in an open month again.
  await syncLateArrivals(reopenedAt, companyId);

  return { ok: true };
}
