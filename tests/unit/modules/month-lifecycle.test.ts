import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeMissingSlots,
  deriveCompanyStage,
  isFutureMonth,
  monthKeyAt,
  selectOpenMonthKey,
} from "../../../src/modules/month-lifecycle.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";

test("describeMissingSlots explains a slot blocked by a deliberate folder", () => {
  const missing = describeMissingSlots(
    [{ name: "04 Pokladňa", classification: { kind: "unknown", name: "04 Pokladňa" } }],
    CANONICAL_FOLDER_NAMES,
  );

  const receipts = missing.find((slot) => slot.canonicalName === "04 Bločky");
  assert.deepEqual(receipts, {
    canonicalName: "04 Bločky",
    blockedByFolderName: "04 Pokladňa",
  });

  // Slots with nothing in the way are missing but not blocked.
  const payroll = missing.find((slot) => slot.canonicalName === "07 Mzdy");
  assert.equal(payroll?.blockedByFolderName, null);
});

test("describeMissingSlots reports nothing once every slot exists", () => {
  const missing = describeMissingSlots(
    CANONICAL_FOLDER_NAMES.map((name) => ({
      name,
      classification: { kind: "canonical" as const, name },
    })),
    CANONICAL_FOLDER_NAMES,
  );
  assert.deepEqual(missing, []);
});

test("describeMissingSlots does not report a slot a repair candidate will become", () => {
  const missing = describeMissingSlots(
    [
      {
        name: "04 Platby hotorvosťou",
        classification: {
          kind: "repair-candidate",
          observedName: "04 Platby hotorvosťou",
          targetName: "04 Platby hotovosťou",
        },
      },
    ],
    CANONICAL_FOLDER_NAMES,
  );
  assert.ok(
    !missing.some((slot) => slot.canonicalName === "04 Platby hotovosťou"),
  );
});

test("deriveCompanyStage reports collect with unknown awaiting count", () => {
  const stage = deriveCompanyStage({ openMonthKey: "2026_02", awaitingCount: null });
  assert.equal(stage.stage, "collect");
  assert.equal(stage.awaitingCount, null);
});

test("deriveCompanyStage degrades when no open month", () => {
  const stage = deriveCompanyStage({ openMonthKey: null, awaitingCount: null });
  assert.equal(stage.stage, "idle");
});

test("monthKeyAt reads the calendar month on the office clock, not in UTC", () => {
  const cases: Array<[instant: string, monthKey: string]> = [
    // November is CET (UTC+1): 23:00Z is already midnight in Bratislava.
    ["2026-11-11T12:00:00.000Z", "2026_11"],
    ["2026-11-30T22:59:59.999Z", "2026_11"],
    ["2026-11-30T23:00:00.000Z", "2026_12"],
    // January 1st in Bratislava is still December 31st in UTC.
    ["2026-12-31T22:59:59.999Z", "2026_12"],
    ["2026-12-31T23:00:00.000Z", "2027_01"],
    // June is CEST (UTC+2): the midnight edge moves to 22:00Z.
    ["2026-06-30T21:59:59.999Z", "2026_06"],
    ["2026-06-30T22:00:00.000Z", "2026_07"],
  ];
  for (const [instant, monthKey] of cases) {
    assert.equal(monthKeyAt(new Date(instant)), monthKey, instant);
  }
});

test("isFutureMonth is true only for keys after the current month", () => {
  const cases: Array<[monthKey: string, current: string, future: boolean]> = [
    ["2026_11", "2026_11", false],
    ["2026_10", "2026_11", false],
    ["2026_12", "2026_11", true],
    ["2027_01", "2026_12", true],
    ["2026_01", "2027_01", false],
  ];
  for (const [monthKey, current, future] of cases) {
    assert.equal(isFutureMonth(monthKey, current), future, `${monthKey} vs ${current}`);
  }
});

const pastYear = (closed: string[]) =>
  Array.from({ length: 12 }, (_, index) => {
    const monthKey = `2026_${String(index + 1).padStart(2, "0")}`;
    return { monthKey, closedAt: closed.includes(monthKey) ? "2026-01-01T00:00:00.000Z" : null };
  });

test("selectOpenMonthKey ignores pre-created future months", () => {
  // Pre-created year, nothing closed, on 2026-11-11: November, not December.
  assert.equal(selectOpenMonthKey(pastYear([]), "2026_11"), "2026_11");
  // Everything up to October closed: November is the open month.
  assert.equal(
    selectOpenMonthKey(pastYear(["2026_01", "2026_02", "2026_03", "2026_04", "2026_05", "2026_06", "2026_07", "2026_08", "2026_09", "2026_10"]), "2026_11"),
    "2026_11",
  );
});

test("selectOpenMonthKey yields the newest unclosed non-future month after out-of-order closes", () => {
  // November and October closed, September still open.
  assert.equal(selectOpenMonthKey(pastYear(["2026_10", "2026_11"]), "2026_11"), "2026_09");
  // Only an older month still open, the newest ones closed.
  assert.equal(
    selectOpenMonthKey(pastYear(["2026_02", "2026_03", "2026_04", "2026_05", "2026_06", "2026_07", "2026_08", "2026_09", "2026_10", "2026_11"]), "2026_11"),
    "2026_01",
  );
});

test("selectOpenMonthKey keeps an unclosed December open in January", () => {
  const months = [
    { monthKey: "2026_11", closedAt: "2026-11-30T10:00:00.000Z" },
    { monthKey: "2026_12", closedAt: null },
    { monthKey: "2027_01", closedAt: null },
  ];
  assert.equal(selectOpenMonthKey(months, "2027_01"), "2027_01");
  assert.equal(selectOpenMonthKey(months.slice(0, 2), "2027_01"), "2026_12");
});

test("selectOpenMonthKey has no open month when everything is closed or still in the future", () => {
  assert.equal(selectOpenMonthKey([], "2026_11"), null);
  assert.equal(selectOpenMonthKey(pastYear(Array.from({ length: 11 }, (_, i) => `2026_${String(i + 1).padStart(2, "0")}`)), "2026_11"), null);
  assert.equal(
    selectOpenMonthKey([{ monthKey: "2026_12", closedAt: null }], "2026_11"),
    null,
  );
});

test("the open month follows the office clock across the first-of-month edge", () => {
  // 2026-11-30 23:30 UTC is already 1 December in Bratislava.
  const before = selectOpenMonthKey(pastYear(["2026_01", "2026_02", "2026_03", "2026_04", "2026_05", "2026_06", "2026_07", "2026_08", "2026_09", "2026_10", "2026_11"]), monthKeyAt(new Date("2026-11-30T22:59:59.999Z")));
  const after = selectOpenMonthKey(pastYear(["2026_01", "2026_02", "2026_03", "2026_04", "2026_05", "2026_06", "2026_07", "2026_08", "2026_09", "2026_10", "2026_11"]), monthKeyAt(new Date("2026-11-30T23:00:00.000Z")));
  assert.equal(before, null);
  assert.equal(after, "2026_12");
});
