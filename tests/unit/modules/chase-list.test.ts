import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chaseActionLabel,
  chaseIsQuiet,
  chaseSeverity,
  deriveChaseState,
  sortChaseRows,
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
