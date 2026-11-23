import {
  bookingMonthKey,
  isMonthKey,
  monthKeyAt,
  OFFICE_TIME_ZONE,
} from "./month-lifecycle";

/**
 * How soon a month's unread documents are read (ADR 0020, amended 2026-11-23).
 * `raised` is the month an accountant has open; `recent` is the booking month
 * and the current one; `backlog` is every other unclosed month in the window.
 */
export type ReadingTier = "raised" | "recent" | "backlog";

/** A company's month as the planner needs it: its key, and whether it is closed. */
export type ReadableMonth = {
  companyId: number;
  monthKey: string;
  closed: boolean;
};

export type PlannedMonth = {
  companyId: number;
  monthKey: string;
  tier: ReadingTier;
};

export type ReadingPlanInput = {
  months: readonly ReadableMonth[];
  instant: Date;
  timeZone?: string;
  /** The first month read on its own (`YYYY_MM`), from *Čítať doklady od*. */
  windowStart: string;
  /** The month an accountant opened, if a page did: read whatever its window. */
  raised?: { companyId: number; monthKey: string } | null;
};

/**
 * The window start when the office has not chosen one: January of the booking
 * month's year. In November 2026 that is 2026_01; in January 2027 it is still
 * 2026_01, because the booking month is then December 2026.
 */
export function defaultReadingWindowStart(
  instant: Date,
  timeZone: string = OFFICE_TIME_ZONE,
): string {
  return `${bookingMonthKey(instant, timeZone).slice(0, 4)}_01`;
}

/**
 * The window start in force: the stored one, or the default. The default is
 * computed each time rather than stored, so it moves with the year.
 */
export function readingWindowStartFor(
  stored: string | null | undefined,
  instant: Date,
  timeZone: string = OFFICE_TIME_ZONE,
): string {
  return stored ?? defaultReadingWindowStart(instant, timeZone);
}

/**
 * Checks what the settings form sent for *Čítať doklady od*: a `YYYY_MM` key.
 * The value is trimmed; a malformed key is refused with the message to show.
 */
export function parseReadingWindowStart(
  input: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = input.trim();
  if (!isMonthKey(value)) {
    return {
      ok: false,
      message: "Čítať doklady od musí byť mesiac vo formáte RRRR_MM, napríklad 2026_01.",
    };
  }
  return { ok: true, value };
}

/**
 * Which months a sweep reads, and in what order: the raised month first, then
 * the recent tier (the booking month, then the current month), then the rest
 * of the window newest first. A month is in the window when its key is at or
 * after the window start and at or before the current month, and it is not
 * closed. Future months are never read ahead of the office's calendar.
 *
 * Pure: the caller supplies the months and the instant. Ordering within a tier
 * is what the queue keeps (BullMQ takes equal priorities in order), so the
 * backlog is queued newest month first.
 */
export function planReading(input: ReadingPlanInput): PlannedMonth[] {
  const timeZone = input.timeZone ?? OFFICE_TIME_ZONE;
  const currentKey = monthKeyAt(input.instant, timeZone);
  const bookingKey = bookingMonthKey(input.instant, timeZone);

  const raised = input.raised
    ? input.months.find(
        (month) =>
          !month.closed &&
          month.companyId === input.raised!.companyId &&
          month.monthKey === input.raised!.monthKey,
      )
    : undefined;

  const planned: PlannedMonth[] = [];
  if (raised) {
    planned.push({ companyId: raised.companyId, monthKey: raised.monthKey, tier: "raised" });
  }

  const recent: ReadableMonth[] = [];
  const backlog: ReadableMonth[] = [];
  for (const month of input.months) {
    if (month === raised || month.closed) {
      continue;
    }
    if (month.monthKey < input.windowStart || month.monthKey > currentKey) {
      continue;
    }
    if (month.monthKey === bookingKey || month.monthKey === currentKey) {
      recent.push(month);
    } else {
      backlog.push(month);
    }
  }

  // The booking month is what the office books now, so it goes before the current one.
  const recentRank = (month: ReadableMonth) => (month.monthKey === bookingKey ? 0 : 1);
  recent.sort(
    (left, right) =>
      recentRank(left) - recentRank(right) || left.companyId - right.companyId,
  );
  backlog.sort(
    (left, right) =>
      right.monthKey.localeCompare(left.monthKey) || left.companyId - right.companyId,
  );

  const plan = (months: ReadableMonth[], tier: ReadingTier): PlannedMonth[] =>
    months.map((month) => ({ companyId: month.companyId, monthKey: month.monthKey, tier }));
  return [...planned, ...plan(recent, "recent"), ...plan(backlog, "backlog")];
}
