import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignCompany,
  assignedCompaniesKey,
  defaultAssignedCompanies,
  filterCompanies,
  hiddenCount,
  isAssigned,
  parseAssignedCompanies,
  serializeAssignedCompanies,
  setMode,
  toggleCompany,
  unassignCompany,
  type AssignedCompanies,
} from "../../../src/modules/assigned-companies.ts";
import { summariseChaseList, type ChaseState } from "../../../src/modules/chase-list.ts";

type Row = {
  driveFolderId: string;
  name: string;
  chaseState: ChaseState;
  monthKey: string | null;
  monthClosed: boolean;
  statementArrivedAt: string | null;
  awaitingCount: number | null;
  profileMissing: boolean;
  structureDeviations: number;
};

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    driveFolderId: id,
    name: id,
    chaseState: "decide",
    monthKey: "2026_07",
    monthClosed: false,
    statementArrivedAt: "2026-08-04T09:00:00.000Z",
    awaitingCount: 2,
    profileMissing: false,
    structureDeviations: 0,
    ...overrides,
  };
}

const ROWS: Row[] = [
  row("drive-a", { awaitingCount: 3, profileMissing: true }),
  row("drive-b", { chaseState: "silent", statementArrivedAt: null, awaitingCount: null }),
  row("drive-c", { chaseState: "ready-to-close", awaitingCount: 0, structureDeviations: 2 }),
  row("drive-d", { chaseState: "idle", monthKey: null, awaitingCount: null }),
];

const MINE: AssignedCompanies = {
  version: 1,
  mode: "mine",
  companies: ["drive-a", "drive-c"],
};

test("the default is the whole office, with nothing assigned", () => {
  assert.deepEqual(defaultAssignedCompanies(), { version: 1, mode: "all", companies: [] });
});

test("the key is namespaced by the lowercased email, so two accountants keep separate lists", () => {
  assert.equal(
    assignedCompaniesKey("Jean.Dossa@Example.com"),
    "hugo.assignedCompanies.v1.jean.dossa@example.com",
  );
  assert.notEqual(
    assignedCompaniesKey("jean@example.com"),
    assignedCompaniesKey("colleague@example.com"),
  );
  assert.equal(
    assignedCompaniesKey("Jean@example.com"),
    assignedCompaniesKey("jean@EXAMPLE.com"),
  );
});

test("serialise then parse round-trips the mode and the assigned ids", () => {
  const raw = serializeAssignedCompanies(MINE);
  assert.deepEqual(parseAssignedCompanies(raw), MINE);
  assert.deepEqual(
    parseAssignedCompanies(serializeAssignedCompanies({ ...MINE, mode: "all" })),
    { ...MINE, mode: "all" },
  );
});

test("the serialised value is a versioned JSON object", () => {
  assert.deepEqual(JSON.parse(serializeAssignedCompanies(MINE)), {
    version: 1,
    mode: "mine",
    companies: ["drive-a", "drive-c"],
  });
});

test("a missing value is the default, not an error", () => {
  assert.deepEqual(parseAssignedCompanies(null), defaultAssignedCompanies());
  assert.deepEqual(parseAssignedCompanies(undefined), defaultAssignedCompanies());
  assert.deepEqual(parseAssignedCompanies(""), defaultAssignedCompanies());
});

test("corrupt JSON becomes the empty default and never throws", () => {
  for (const raw of ["{", "not json", "[1,2", "{\"version\":1,", "undefined"]) {
    assert.deepEqual(parseAssignedCompanies(raw), defaultAssignedCompanies(), raw);
  }
});

test("a value that is not an object becomes the empty default", () => {
  for (const raw of ["null", "42", "\"mine\"", "true", "[]", "[\"drive-a\"]"]) {
    assert.deepEqual(parseAssignedCompanies(raw), defaultAssignedCompanies(), raw);
  }
});

test("another version is treated as foreign and recovers to the empty default", () => {
  const future = JSON.stringify({ version: 2, mode: "mine", companies: ["drive-a"] });
  const missingVersion = JSON.stringify({ mode: "mine", companies: ["drive-a"] });
  const stringVersion = JSON.stringify({ version: "1", mode: "mine", companies: ["drive-a"] });
  assert.deepEqual(parseAssignedCompanies(future), defaultAssignedCompanies());
  assert.deepEqual(parseAssignedCompanies(missingVersion), defaultAssignedCompanies());
  assert.deepEqual(parseAssignedCompanies(stringVersion), defaultAssignedCompanies());
});

test("a companies value that is not an array of ids is treated as corrupt", () => {
  const notArrays = [
    { version: 1, mode: "mine", companies: "drive-a" },
    { version: 1, mode: "mine", companies: { "drive-a": true } },
    { version: 1, mode: "mine", companies: null },
    { version: 1, mode: "mine" },
  ];
  for (const value of notArrays) {
    assert.deepEqual(
      parseAssignedCompanies(JSON.stringify(value)),
      defaultAssignedCompanies(),
      JSON.stringify(value),
    );
  }
  const mixed = { version: 1, mode: "mine", companies: ["drive-a", 7] };
  assert.deepEqual(parseAssignedCompanies(JSON.stringify(mixed)), defaultAssignedCompanies());
});

test("an unknown mode is treated as corrupt", () => {
  const value = { version: 1, mode: "everyone", companies: ["drive-a"] };
  assert.deepEqual(parseAssignedCompanies(JSON.stringify(value)), defaultAssignedCompanies());
});

test("duplicate ids in storage are read once", () => {
  const value = { version: 1, mode: "mine", companies: ["drive-a", "drive-a"] };
  assert.deepEqual(parseAssignedCompanies(JSON.stringify(value)).companies, ["drive-a"]);
});

test("adding and removing are idempotent", () => {
  const once = assignCompany(defaultAssignedCompanies(), "drive-a");
  const twice = assignCompany(once, "drive-a");
  assert.deepEqual(once.companies, ["drive-a"]);
  assert.deepEqual(twice.companies, ["drive-a"]);

  const removed = unassignCompany(twice, "drive-a");
  assert.deepEqual(removed.companies, []);
  assert.deepEqual(unassignCompany(removed, "drive-a").companies, []);
  assert.deepEqual(unassignCompany(removed, "never-assigned").companies, []);
});

test("toggling flips membership and keeps the mode", () => {
  const start: AssignedCompanies = { ...MINE, mode: "all" };
  const on = toggleCompany(start, "drive-b");
  assert.equal(isAssigned(on, "drive-b"), true);
  assert.equal(on.mode, "all");

  const off = toggleCompany(on, "drive-b");
  assert.equal(isAssigned(off, "drive-b"), false);
  assert.equal(off.mode, "all");
});

test("the mode can be switched without touching the assignments", () => {
  const switched = setMode(MINE, "all");
  assert.equal(switched.mode, "all");
  assert.deepEqual(switched.companies, MINE.companies);
  assert.equal(setMode(switched, "mine").mode, "mine");
});

test("the mode lists every company", () => {
  const visible = filterCompanies(ROWS, { ...MINE, mode: "all" });
  assert.deepEqual(visible.map((company) => company.driveFolderId), [
    "drive-a",
    "drive-b",
    "drive-c",
    "drive-d",
  ]);
  assert.equal(hiddenCount(ROWS, { ...MINE, mode: "all" }), 0);
});

test("Moje firmy lists only the assigned companies, in their original order", () => {
  const visible = filterCompanies(ROWS, MINE);
  assert.deepEqual(visible.map((company) => company.driveFolderId), ["drive-a", "drive-c"]);
  assert.equal(hiddenCount(ROWS, MINE), 2);
});

test("unknown ids are ignored by the filter and kept in the state", () => {
  const state: AssignedCompanies = {
    ...MINE,
    companies: ["drive-a", "gone-from-drive"],
  };
  const visible = filterCompanies(ROWS, state);
  assert.deepEqual(visible.map((company) => company.driveFolderId), ["drive-a"]);
  assert.equal(hiddenCount(ROWS, state), 3);
  assert.deepEqual(state.companies, ["drive-a", "gone-from-drive"]);
});

test("a company that returns to Drive reappears with its assignment", () => {
  const state: AssignedCompanies = { ...MINE, companies: ["drive-a", "returning"] };
  assert.deepEqual(
    filterCompanies(ROWS.slice(0, 1), state).map((company) => company.driveFolderId),
    ["drive-a"],
  );
  const restored = [...ROWS, row("returning")];
  assert.deepEqual(
    filterCompanies(restored, state).map((company) => company.driveFolderId),
    ["drive-a", "returning"],
  );
});

test("with nothing assigned Moje firmy is empty and hides every company", () => {
  const empty: AssignedCompanies = { ...MINE, companies: [] };
  assert.deepEqual(filterCompanies(ROWS, empty), []);
  assert.equal(hiddenCount(ROWS, empty), ROWS.length);
});

test("hidden count is zero when every company is assigned", () => {
  const all: AssignedCompanies = {
    ...MINE,
    companies: ROWS.map((company) => company.driveFolderId),
  };
  assert.equal(hiddenCount(ROWS, all), 0);
});

test("the summary counts only the visible rows, so the figures can reach zero", () => {
  const everything = summariseChaseList(ROWS);
  assert.equal(everything.awaitingTotal, 3);
  assert.equal(everything.silent, 1);
  assert.equal(everything.withoutProfile, 1);
  assert.equal(everything.withStructureDeviations, 1);

  const mine = summariseChaseList(filterCompanies(ROWS, MINE));
  assert.equal(mine.awaitingTotal, 3);
  assert.equal(mine.silent, 0);
  assert.equal(mine.readyToClose, 1);
  assert.equal(mine.withoutProfile, 1);
  assert.equal(mine.withStructureDeviations, 1);
  assert.equal(mine.withoutStatement, 0);

  const none = summariseChaseList(filterCompanies(ROWS, { ...MINE, companies: [] }));
  assert.deepEqual(none, {
    awaitingTotal: 0,
    withoutStatement: 0,
    silent: 0,
    readyToClose: 0,
    withoutProfile: 0,
    withStructureDeviations: 0,
  });
});
