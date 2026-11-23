import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultReadingWindowStart,
  parseReadingWindowStart,
  planReading,
  readingWindowStartFor,
  type ReadableMonth,
} from "../../../src/modules/reading-planner.ts";

/** 23 November 2026, midday on the office clock: booking October, current November. */
const NOVEMBER = new Date("2026-11-23T11:00:00.000Z");

const YEAR = [
  "2026_01", "2026_02", "2026_03", "2026_04", "2026_05", "2026_06",
  "2026_07", "2026_08", "2026_09", "2026_10", "2026_11", "2026_12",
];

function months(companyId: number, keys: string[], closed: string[] = []): ReadableMonth[] {
  return keys.map((monthKey) => ({ companyId, monthKey, closed: closed.includes(monthKey) }));
}

function plan(input: {
  months: ReadableMonth[];
  instant?: Date;
  windowStart?: string;
  raised?: { companyId: number; monthKey: string } | null;
}) {
  return planReading({
    months: input.months,
    instant: input.instant ?? NOVEMBER,
    windowStart: input.windowStart ?? "2026_01",
    raised: input.raised ?? null,
  });
}

function summary(planned: ReturnType<typeof planReading>): string[] {
  return planned.map((entry) => `${entry.companyId}/${entry.monthKey}/${entry.tier}`);
}

test("the window runs from its start to the current month; closed and future months are left out", () => {
  const planned = plan({
    months: months(1, YEAR, ["2026_08"]),
    windowStart: "2026_09",
  });
  // September to November are unclosed and in the window. August is closed,
  // January to July are before the window, December is in the future.
  assert.deepEqual(summary(planned), ["1/2026_10/recent", "1/2026_11/recent", "1/2026_09/backlog"]);
});

test("the window start is inclusive", () => {
  const planned = plan({ months: months(1, YEAR), windowStart: "2026_10" });
  assert.deepEqual(summary(planned), ["1/2026_10/recent", "1/2026_11/recent"]);
});

test("the booking month is the previous calendar month on the office clock, across the year", () => {
  // 5 January 2027: the booking month is December 2026, the current month January 2027.
  const january = plan({
    months: months(1, ["2026_11", "2026_12", "2027_01"]),
    instant: new Date("2027-01-05T09:00:00.000Z"),
    windowStart: "2026_11",
  });
  assert.deepEqual(summary(january), ["1/2026_12/recent", "1/2027_01/recent", "1/2026_11/backlog"]);
});

test("the office clock decides the month: 00:30 on the 1st is already the new month", () => {
  // 30 November 23:30 UTC is 1 December 00:30 in Bratislava: December is current, November is booked.
  const justAfterMidnight = plan({
    months: months(1, ["2026_10", "2026_11", "2026_12"]),
    instant: new Date("2026-11-30T23:30:00.000Z"),
  });
  assert.deepEqual(summary(justAfterMidnight), ["1/2026_11/recent", "1/2026_12/recent", "1/2026_10/backlog"]);
});

test("tiers run raised, then recent (booking month first), then backlog newest first", () => {
  const planned = plan({
    months: [
      ...months(1, ["2026_03", "2026_09", "2026_10", "2026_11"]),
      ...months(2, ["2026_09", "2026_10", "2026_11"]),
    ],
    raised: { companyId: 2, monthKey: "2026_09" },
  });
  assert.deepEqual(summary(planned), [
    "2/2026_09/raised",
    "1/2026_10/recent",
    "2/2026_10/recent",
    "1/2026_11/recent",
    "2/2026_11/recent",
    "1/2026_09/backlog",
    "1/2026_03/backlog",
  ]);
});

test("a raised month is read first even before the window", () => {
  const planned = plan({
    months: months(1, ["2026_02", "2026_11"]),
    windowStart: "2026_10",
    raised: { companyId: 1, monthKey: "2026_02" },
  });
  assert.deepEqual(summary(planned), ["1/2026_02/raised", "1/2026_11/recent"]);
});

test("a raised month that is closed is not read", () => {
  const planned = plan({
    months: months(1, ["2026_02", "2026_11"], ["2026_02"]),
    windowStart: "2026_01",
    raised: { companyId: 1, monthKey: "2026_02" },
  });
  assert.deepEqual(summary(planned), ["1/2026_11/recent"]);
});

test("a raised month is not repeated among the window's tiers", () => {
  const planned = plan({
    months: months(1, ["2026_10", "2026_11"]),
    raised: { companyId: 1, monthKey: "2026_10" },
  });
  assert.deepEqual(summary(planned), ["1/2026_10/raised", "1/2026_11/recent"]);
});

test("a window start after the booking month leaves only the current month recent", () => {
  const planned = plan({ months: months(1, ["2026_10", "2026_11"]), windowStart: "2026_11" });
  assert.deepEqual(summary(planned), ["1/2026_11/recent"]);
});

test("the default window start is January of the booking month's year", () => {
  assert.equal(defaultReadingWindowStart(NOVEMBER), "2026_01");
  // January 2027: the booking month is December 2026, so the default stays in 2026.
  assert.equal(defaultReadingWindowStart(new Date("2027-01-05T09:00:00.000Z")), "2026_01");
  // February 2027: the booking month is January 2027.
  assert.equal(defaultReadingWindowStart(new Date("2027-02-03T09:00:00.000Z")), "2027_01");
});

test("a stored window start is used as it is; none stored means the default", () => {
  assert.equal(readingWindowStartFor("2026_06", NOVEMBER), "2026_06");
  assert.equal(readingWindowStartFor(null, NOVEMBER), "2026_01");
  assert.equal(readingWindowStartFor(undefined, new Date("2027-02-03T09:00:00.000Z")), "2027_01");
});

test("the window start setting accepts only YYYY_MM and trims it", () => {
  assert.deepEqual(parseReadingWindowStart("2026_01"), { ok: true, value: "2026_01" });
  assert.deepEqual(parseReadingWindowStart("  2026_11 "), { ok: true, value: "2026_11" });
  for (const invalid of ["", "2026-01", "2026_13", "2026_00", "26_01", "2026_1", "2026_01_01", "janúar"]) {
    const result = parseReadingWindowStart(invalid);
    assert.equal(result.ok, false, `${JSON.stringify(invalid)} must be refused`);
    if (!result.ok) {
      assert.match(result.message, /RRRR_MM/);
    }
  }
});
