import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chaseActionLabel,
  chaseIsQuiet,
  chaseSeverity,
  CHASE_FILTERS,
  deriveChaseState,
  matchesChaseFilter,
  sortChaseRows,
  summariseChaseList,
  type ChaseFilter,
  type ChaseSummaryRow,
} from "../../../src/modules/chase-list.ts";

const BASE = {
  monthKey: "2026_07",
  monthRequested: false,
  monthClosed: false,
  statementArrivedAt: "2026-08-04T09:00:00.000Z",
  proofsArrived: 8,
  awaitingCount: 5,
  lastUploadAt: "2026-08-28T12:20:00.000Z",
};

test("a company with no open month is idle rather than a row of dashes", () => {
  assert.equal(deriveChaseState({ ...BASE, monthKey: null }), "idle");
});

test("asking for a month a company does not have says so instead of idle", () => {
  assert.equal(
    deriveChaseState({ ...BASE, monthKey: null, monthRequested: true }),
    "no-month",
  );
  assert.equal(chaseActionLabel("no-month", null), "Tento mesiac tu nie je");
});

test("a closed month is read-only, so it is never an action", () => {
  assert.equal(deriveChaseState({ ...BASE, monthClosed: true }), "closed");
  // Even with documents left undecided: the month is shut, nothing is her move.
  assert.equal(
    deriveChaseState({ ...BASE, monthClosed: true, awaitingCount: 12 }),
    "closed",
  );
  assert.ok(chaseIsQuiet("closed"));
  assert.equal(chaseSeverity("closed"), "none");
});

test("a client who has uploaded nothing outranks every other kind of problem", () => {
  assert.equal(
    deriveChaseState({
      ...BASE,
      lastUploadAt: null,
      statementArrivedAt: null,
      proofsArrived: 0,
      awaitingCount: 0,
    }),
    "silent",
  );
});

test("a missing statement is distinct from missing proofs", () => {
  assert.equal(
    deriveChaseState({ ...BASE, statementArrivedAt: null }),
    "no-statement",
  );
  assert.equal(
    deriveChaseState({ ...BASE, proofsArrived: 0, awaitingCount: 0 }),
    "no-proofs",
  );
});

test("zero awaiting means ready to close, which is not the same as silent", () => {
  const ready = deriveChaseState({ ...BASE, awaitingCount: 0 });
  const silent = deriveChaseState({
    ...BASE,
    lastUploadAt: null,
    statementArrivedAt: null,
    proofsArrived: 0,
    awaitingCount: 0,
  });
  assert.equal(ready, "ready-to-close");
  assert.equal(silent, "silent");
  assert.notEqual(chaseSeverity(ready), chaseSeverity(silent));
  assert.equal(chaseSeverity(ready), "done");
  assert.equal(chaseSeverity(silent), "critical");
});

test("a company still collecting documents reads as decide with its count", () => {
  assert.equal(deriveChaseState(BASE), "decide");
  assert.equal(chaseActionLabel("decide", 5), "Rozhodnúť 5");
  assert.equal(chaseActionLabel("idle", null), "Nečinná — žiadny otvorený mesiac");
});

test("rows sort by who owes her something, then by name", () => {
  const sorted = sortChaseRows([
    { name: "Dunaj Servis s.r.o.", chaseState: "ready-to-close" as const },
    { name: "Tatra Logistic s.r.o.", chaseState: "decide" as const },
    { name: "Modrý Dom s.r.o.", chaseState: "silent" as const },
    { name: "Alfa s.r.o.", chaseState: "decide" as const },
    { name: "Zima s.r.o.", chaseState: "no-month" as const },
    { name: "Vlnka Studio s.r.o.", chaseState: "idle" as const },
    { name: "Jeseň s.r.o.", chaseState: "closed" as const },
    { name: "Perla s.r.o.", chaseState: "no-statement" as const },
  ]);

  assert.deepEqual(
    sorted.map((row) => row.name),
    [
      "Modrý Dom s.r.o.",
      "Perla s.r.o.",
      "Alfa s.r.o.",
      "Tatra Logistic s.r.o.",
      "Dunaj Servis s.r.o.",
      "Jeseň s.r.o.",
      "Vlnka Studio s.r.o.",
      "Zima s.r.o.",
    ],
  );
});

test("each summary figure filters to exactly the companies it counts", () => {
  const row = (overrides: Partial<ChaseSummaryRow>): ChaseSummaryRow => ({
    monthKey: "2026_11",
    monthClosed: false,
    statementArrivedAt: "2026-11-03T08:00:00.000Z",
    chaseState: "decide",
    awaitingCount: 0,
    profileMissing: false,
    structureDeviations: 0,
    ...overrides,
  });
  const rows = [
    row({ awaitingCount: 3 }),
    row({ statementArrivedAt: null }),
    row({ statementArrivedAt: null, monthClosed: true }),
    row({ chaseState: "silent", statementArrivedAt: null }),
    row({ chaseState: "ready-to-close" }),
    row({ profileMissing: true }),
    row({ structureDeviations: 2 }),
    row({ monthKey: null, statementArrivedAt: null, awaitingCount: null, chaseState: "idle" }),
  ];
  const summary = summariseChaseList(rows);
  const count = (filter: ChaseFilter) => rows.filter((company) => matchesChaseFilter(company, filter)).length;

  assert.equal(count("without-statement"), summary.withoutStatement);
  assert.equal(count("silent"), summary.silent);
  assert.equal(count("ready-to-close"), summary.readyToClose);
  assert.equal(count("profile-missing"), summary.withoutProfile);
  assert.equal(count("structure"), summary.withStructureDeviations);
  assert.equal(count("awaiting"), 1, "the companies with documents waiting, whose sum is the figure");
  assert.equal(summary.awaitingTotal, 3);
  assert.equal(CHASE_FILTERS.length, 6);
});
