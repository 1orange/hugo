import { tierOfPriority } from "@/adapters/job-queue/port";
import type { ReadingTier } from "@/modules/reading-planner";
import type { QueueLane } from "./types";

/** One waiting document, as the queue holds it: queued or delayed, never running. */
export type WaitingEntry = {
  lane: QueueLane;
  /** The priority BullMQ holds for the job now (a raised month's jobs are already moved). */
  priority: number;
  /** When the job was queued, in ms; the tie-break BullMQ itself uses. */
  timestamp: number;
  companyId: number;
  companyName: string;
  monthKey: string;
};

/**
 * The waiting documents of one company in one month, split by lane. Keyed by
 * companyId, so the visible-companies filter (ADR 0023) can keep or drop rows
 * without reading the names.
 */
export type WaitingMonth = {
  companyId: number;
  companyName: string;
  monthKey: string;
  /** The tier of the month's first document in the queue: how soon it is read. */
  tier: ReadingTier;
  /** Waiting in the reading lane. */
  reading: number;
  /** Waiting for the model. */
  model: number;
};

export type WaitingTotals = { reading: number; model: number };

function takeOrder(left: WaitingEntry, right: WaitingEntry): number {
  return left.priority - right.priority || left.timestamp - right.timestamp;
}

/**
 * Groups the waiting documents by company and month, in the order they will be
 * read: the first document in BullMQ's take order decides a group's place and
 * tier. A month the queue reads in two tiers (a document handed over after the
 * month was raised) therefore shows the sooner one.
 *
 * Pure: the entries are whatever the queue listed, in any order.
 */
export function waitingMonths(entries: readonly WaitingEntry[]): WaitingMonth[] {
  const groups = new Map<string, WaitingMonth>();
  for (const entry of [...entries].sort(takeOrder)) {
    const key = `${entry.companyId}/${entry.monthKey}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        companyId: entry.companyId,
        companyName: entry.companyName,
        monthKey: entry.monthKey,
        tier: tierOfPriority(entry.priority),
        reading: 0,
        model: 0,
      };
      groups.set(key, group);
    }
    if (entry.lane === "read") {
      group.reading += 1;
    } else {
      group.model += 1;
    }
  }
  return [...groups.values()];
}

/** The waiting documents in each lane, summed over every company and month. */
export function waitingTotals(months: readonly WaitingMonth[]): WaitingTotals {
  return months.reduce(
    (totals, month) => ({ reading: totals.reading + month.reading, model: totals.model + month.model }),
    { reading: 0, model: 0 },
  );
}
