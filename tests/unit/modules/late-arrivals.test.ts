import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessLateArrival,
  isLateArrival,
  isPassedMonthArrival,
  uploadTimeOf,
  planLateArrivalSync,
  type LateArrivalEntry,
  type LateArrivalFile,
} from "../../../src/modules/late-arrivals.ts";

const CLOSED_AT = "2026-10-20T10:00:00.000Z";
const MOVABLE = ["02 Prijaté faktúry", "04 Bločky", "04 Bločky", "06 Ostatné dokumenty"];

function file(overrides: Partial<LateArrivalFile> = {}): LateArrivalFile {
  return {
    driveFileId: "file-1",
    monthKey: "2026_09",
    folderSlot: "02 Prijaté faktúry",
    parentId: "slot-09-02",
    deleted: false,
    firstSeenAt: "2026-10-21T08:00:00.000Z",
    arrivedAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<LateArrivalEntry> = {}): LateArrivalEntry {
  return {
    id: 1,
    driveFileId: "file-1",
    status: "pending",
    sourceMonthKey: "2026_09",
    folderSlot: "02 Prijaté faktúry",
    sourceParentId: "slot-09-02",
    detectedAt: "2026-10-21T08:00:00.000Z",
    statusChangedAt: null,
    ...overrides,
  };
}

test("a file first seen after its month was closed is late; one seen before is not", () => {
  assert.equal(isLateArrival(file(), CLOSED_AT), true);
  assert.equal(isLateArrival(file({ firstSeenAt: "2026-10-19T08:00:00.000Z" }), CLOSED_AT), false);
  assert.equal(isLateArrival(file(), null), false, "an open month has no late arrivals");
});

test("a file moved into a closed month from another month is late from when it arrived", () => {
  const moved = file({ firstSeenAt: "2026-08-02T08:00:00.000Z", arrivedAt: "2026-10-22T08:00:00.000Z" });
  assert.equal(isLateArrival(moved, CLOSED_AT), true);
});

test("the month root (the VAT PDFs) and deleted files are never late", () => {
  assert.equal(isLateArrival(file({ folderSlot: null }), CLOSED_AT), false);
  assert.equal(isLateArrival(file({ deleted: true }), CLOSED_AT), false);
});

test("the sync logs a new late file, and resolves a pending one that is late no more", () => {
  const closed = new Map([["2026_09", CLOSED_AT]]);
  const fresh = planLateArrivalSync({ files: [file()], closedAtByMonth: closed, entries: [] });
  assert.deepEqual(fresh.detected, [
    {
      driveFileId: "file-1",
      sourceMonthKey: "2026_09",
      folderSlot: "02 Prijaté faktúry",
      sourceParentId: "slot-09-02",
      arrivedAt: "2026-10-21T08:00:00.000Z",
    },
  ]);
  assert.deepEqual(fresh.resolved, []);

  const same = planLateArrivalSync({ files: [file()], closedAtByMonth: closed, entries: [entry()] });
  assert.deepEqual(same, { detected: [], resolved: [] }, "a logged one is not logged again");

  // Reopened: the month is not closed any more.
  const reopened = planLateArrivalSync({ files: [file()], closedAtByMonth: new Map(), entries: [entry()] });
  assert.deepEqual(reopened, { detected: [], resolved: [1] });

  // Moved out by someone: in the open month now.
  const movedOut = planLateArrivalSync({
    files: [file({ monthKey: "2026_11", arrivedAt: "2026-11-02T08:00:00.000Z" })],
    closedAtByMonth: closed,
    entries: [entry()],
  });
  assert.deepEqual(movedOut.resolved, [1]);
});

test("an ignored entry stays ignored, unless the file arrived again after that", () => {
  const closed = new Map([["2026_09", CLOSED_AT]]);
  const ignored = entry({ status: "ignored", statusChangedAt: "2026-10-25T08:00:00.000Z" });
  assert.deepEqual(planLateArrivalSync({ files: [file()], closedAtByMonth: closed, entries: [ignored] }), {
    detected: [],
    resolved: [],
  });

  const back = file({ arrivedAt: "2026-10-28T08:00:00.000Z" });
  assert.equal(planLateArrivalSync({ files: [back], closedAtByMonth: closed, entries: [ignored] }).detected.length, 1);
});

test("a pending entry follows its file to another folder of a closed month", () => {
  const closed = new Map([["2026_09", CLOSED_AT]]);
  const plan = planLateArrivalSync({
    files: [file({ folderSlot: "06 Ostatné dokumenty", parentId: "slot-09-06" })],
    closedAtByMonth: closed,
    entries: [entry()],
  });
  assert.equal(plan.detected[0]?.folderSlot, "06 Ostatné dokumenty");
});

const DESTINATIONS = [
  { name: "02 Prijaté faktúry", driveFolderId: "slot-11-02" },
  { name: "03 Bankové výpisy", driveFolderId: "slot-11-03" },
];

test("a late arrival in a movable folder is proposed for the open month's folder of the same name", () => {
  assert.deepEqual(
    assessLateArrival({
      folderSlot: "02 Prijaté faktúry",
      canMove: true,
      movableFolderNames: MOVABLE,
      targetMonthKey: "2026_11",
      destinationFolders: DESTINATIONS,
    }),
    { kind: "move", targetMonthKey: "2026_11", targetFolderId: "slot-11-02" },
  );
});

test("a bank statement, issued invoice or payroll is a warning, never a move", () => {
  for (const folderSlot of ["01 Vydané faktúry", "03 Bankové výpisy", "07 Mzdy"]) {
    assert.deepEqual(
      assessLateArrival({ folderSlot, canMove: true, movableFolderNames: MOVABLE, targetMonthKey: "2026_11", destinationFolders: DESTINATIONS }),
      { kind: "warning", reason: "not-movable-folder" },
    );
  }
});

test("no open month, a missing destination folder, or a file Drive will not move is a warning", () => {
  const base = { folderSlot: "02 Prijaté faktúry", canMove: true, movableFolderNames: MOVABLE, destinationFolders: DESTINATIONS };
  assert.deepEqual(assessLateArrival({ ...base, targetMonthKey: null }), { kind: "warning", reason: "no-open-month" });
  assert.deepEqual(assessLateArrival({ ...base, targetMonthKey: "2026_11", destinationFolders: [] }), {
    kind: "warning",
    reason: "missing-destination",
    targetMonthKey: "2026_11",
  });
  assert.deepEqual(assessLateArrival({ ...base, targetMonthKey: "2026_11", canMove: false }), {
    kind: "warning",
    reason: "cannot-move",
  });
});

// ADR 0006, amended 2026-11-24: an upload into a month after it stopped being
// booked is late too, from the moment the rule was first applied.
const SINCE = "2026-11-24T08:00:00.000Z";

test("an upload into September from November on is late; one in October is not", () => {
  const november = file({ driveCreatedTime: "2026-11-25T09:00:00.000Z" });
  const october = file({ driveCreatedTime: "2026-10-20T09:00:00.000Z", firstSeenAt: "2026-11-25T09:00:00.000Z" });
  assert.equal(isPassedMonthArrival(november, SINCE), true);
  assert.equal(isPassedMonthArrival(october, SINCE), false, "September was booked in October");
});

test("only uploads since the rule was applied count, and never by when Hugo first saw them", () => {
  // A rebuilt database first sees every file today: the upload time decides.
  const history = file({ monthKey: "2026_06", driveCreatedTime: "2026-09-02T09:00:00.000Z", firstSeenAt: "2026-11-25T10:00:00.000Z" });
  assert.equal(isPassedMonthArrival(history, SINCE), false);
  assert.equal(uploadTimeOf(history), "2026-09-02T09:00:00.000Z");
  // A file moved into the old month after the rule began: its move is when it came.
  const movedIn = file({ monthKey: "2026_06", driveCreatedTime: "2026-06-02T09:00:00.000Z", arrivedAt: "2026-11-26T09:00:00.000Z" });
  assert.equal(isPassedMonthArrival(movedIn, SINCE), true);
  assert.equal(isPassedMonthArrival(file({ driveCreatedTime: "2026-11-25T09:00:00.000Z" }), null), false, "off until set");
});

test("the booking month is read on the office clock", () => {
  // 31 October, 23:30 UTC is 1 November in Bratislava: October is booked, September is late.
  assert.equal(isPassedMonthArrival(file({ driveCreatedTime: "2026-10-31T23:30:00.000Z" }), "2026-10-01T00:00:00.000Z"), true);
  assert.equal(isPassedMonthArrival(file({ driveCreatedTime: "2026-10-31T22:30:00.000Z" }), "2026-10-01T00:00:00.000Z"), false);
});

test("the sync logs an upload into a passed month, with its upload time, and resolves it once moved out", () => {
  const late = file({ driveCreatedTime: "2026-11-25T09:00:00.000Z" });
  const plan = planLateArrivalSync({ files: [late], closedAtByMonth: new Map(), entries: [], passedMonthsSince: SINCE });
  assert.deepEqual(plan.detected, [
    { driveFileId: "file-1", sourceMonthKey: "2026_09", folderSlot: "02 Prijaté faktúry", sourceParentId: "slot-09-02", arrivedAt: "2026-11-25T09:00:00.000Z" },
  ]);
  const pending = entry({ driveFileId: "file-1", status: "pending" });
  const movedOut = planLateArrivalSync({
    files: [{ ...late, monthKey: "2026_10" }],
    closedAtByMonth: new Map(),
    entries: [pending],
    passedMonthsSince: SINCE,
  });
  assert.deepEqual(movedOut.resolved, [pending.id]);
});

test("a late arrival is never proposed for the month it came from, or an older one", () => {
  const base = { folderSlot: "02 Prijaté faktúry", canMove: true, movableFolderNames: ["02 Prijaté faktúry"], destinationFolders: [{ name: "02 Prijaté faktúry", driveFolderId: "d" }] };
  assert.deepEqual(assessLateArrival({ ...base, targetMonthKey: "2026_09", sourceMonthKey: "2026_09" }), { kind: "warning", reason: "no-open-month" });
  assert.equal(assessLateArrival({ ...base, targetMonthKey: "2026_10", sourceMonthKey: "2026_09" }).kind, "move");
});

test("a file Hugo moved into its target is not late there, even when that month is long past", () => {
  // The dormant-client fallback: moved into the open month 2026_01, in November.
  const moved = file({ monthKey: "2026_01", driveCreatedTime: "2025-12-20T09:00:00.000Z", arrivedAt: "2026-11-25T10:00:00.000Z" });
  const done = entry({ status: "moved", sourceMonthKey: "2025_12", targetMonthKey: "2026_01", statusChangedAt: "2026-11-25T09:59:00.000Z" });
  const plan = planLateArrivalSync({ files: [moved], closedAtByMonth: new Map(), entries: [done], passedMonthsSince: SINCE });
  assert.deepEqual(plan.detected, []);
});
