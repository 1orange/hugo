import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKLOG_DOCUMENT_PRIORITY,
  RAISED_DOCUMENT_PRIORITY,
  priorityFor,
  tierOfPriority,
} from "../../../src/adapters/job-queue/port.ts";
import {
  waitingMonths,
  waitingTotals,
  type WaitingEntry,
} from "../../../src/lib/extraction-queue/waiting.ts";
import type { ReadingTier } from "../../../src/modules/reading-planner.ts";

const TIERS: ReadingTier[] = ["raised", "recent", "backlog"];

test("a tier's priorities read back as the same tier, for receipts and documents alike", () => {
  for (const tier of TIERS) {
    for (const kind of ["receipt", "document"] as const) {
      assert.equal(tierOfPriority(priorityFor(kind, tier)), tier, `${kind} in ${tier}`);
    }
  }
  assert.equal(tierOfPriority(RAISED_DOCUMENT_PRIORITY), "raised");
  assert.equal(tierOfPriority(BACKLOG_DOCUMENT_PRIORITY), "backlog");
});

function entry(overrides: Partial<WaitingEntry> & Pick<WaitingEntry, "companyId" | "monthKey">): WaitingEntry {
  return {
    lane: "read",
    priority: priorityFor("document", "backlog"),
    timestamp: 0,
    companyName: `Firma ${overrides.companyId}`,
    ...overrides,
  };
}

test("waiting documents are counted per company and month, split by lane", () => {
  const months = waitingMonths([
    entry({ companyId: 1, monthKey: "2026_10", lane: "read" }),
    entry({ companyId: 1, monthKey: "2026_10", lane: "read" }),
    entry({ companyId: 1, monthKey: "2026_10", lane: "model" }),
    entry({ companyId: 2, monthKey: "2026_10", lane: "model" }),
  ]);
  assert.deepEqual(months, [
    { companyId: 1, companyName: "Firma 1", monthKey: "2026_10", tier: "backlog", reading: 2, model: 1 },
    { companyId: 2, companyName: "Firma 2", monthKey: "2026_10", tier: "backlog", reading: 0, model: 1 },
  ]);
});

test("months come in the order the queue takes them: raised, then recent, then backlog", () => {
  // Given out of order on purpose: the builder sorts by the priority the job holds.
  const months = waitingMonths([
    entry({ companyId: 3, monthKey: "2026_01", priority: priorityFor("document", "backlog"), timestamp: 1 }),
    entry({ companyId: 2, monthKey: "2026_11", priority: priorityFor("document", "recent"), timestamp: 2 }),
    entry({ companyId: 1, monthKey: "2026_09", priority: priorityFor("receipt", "raised"), timestamp: 3 }),
  ]);
  assert.deepEqual(
    months.map((month) => [month.monthKey, month.tier]),
    [
      ["2026_09", "raised"],
      ["2026_11", "recent"],
      ["2026_01", "backlog"],
    ],
  );
});

test("within a tier, the order is BullMQ's: priority first, then when the job was queued", () => {
  const backlog = priorityFor("document", "backlog");
  const months = waitingMonths([
    entry({ companyId: 1, monthKey: "2026_03", priority: backlog, timestamp: 30 }),
    entry({ companyId: 1, monthKey: "2026_02", priority: backlog, timestamp: 20 }),
    entry({ companyId: 1, monthKey: "2026_04", priority: backlog, timestamp: 40 }),
  ]);
  assert.deepEqual(
    months.map((month) => month.monthKey),
    ["2026_02", "2026_03", "2026_04"],
  );
});

test("a month read in two tiers shows the sooner one", () => {
  // A document handed over later, after the month was raised, keeps the raised priority.
  const months = waitingMonths([
    entry({ companyId: 1, monthKey: "2026_10", priority: priorityFor("document", "backlog"), timestamp: 1 }),
    entry({ companyId: 1, monthKey: "2026_10", priority: priorityFor("document", "raised"), timestamp: 2 }),
  ]);
  assert.equal(months.length, 1);
  assert.equal(months[0]!.tier, "raised");
  assert.equal(months[0]!.reading + months[0]!.model, 2);
});

test("with nothing waiting there are no months, and the totals are zero", () => {
  assert.deepEqual(waitingMonths([]), []);
  assert.deepEqual(waitingTotals([]), { reading: 0, model: 0 });
});

test("the totals add the lanes up over every month", () => {
  const months = waitingMonths([
    entry({ companyId: 1, monthKey: "2026_10", lane: "read" }),
    entry({ companyId: 1, monthKey: "2026_10", lane: "model" }),
    entry({ companyId: 2, monthKey: "2026_09", lane: "model" }),
    entry({ companyId: 2, monthKey: "2026_09", lane: "model" }),
  ]);
  assert.deepEqual(waitingTotals(months), { reading: 1, model: 3 });
});
