import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyGroupKey,
  companyGroupsOf,
  filterByGroup,
  parseCompanyGroup,
} from "../../../src/modules/company-groups.ts";

const ROWS = [
  { id: 1, groupName: "Katarína" },
  { id: 2, groupName: "Archív" },
  { id: 3, groupName: "Eva" },
  { id: 4, groupName: null },
  { id: 5, groupName: "Eva" },
];

test("the groups are the accountants alphabetically, then the archive", () => {
  assert.deepEqual(companyGroupsOf(ROWS), ["Eva", "Katarína", "Archív"]);
  assert.deepEqual(companyGroupsOf([{ groupName: null }]), [], "a drive without groups offers none");
});

test("a group narrows the companies; none chosen shows them all", () => {
  assert.deepEqual(filterByGroup(ROWS, "Eva").map((row) => row.id), [3, 5]);
  assert.equal(filterByGroup(ROWS, null).length, 5);
});

test("a stored group that no longer exists falls back to every group", () => {
  const groups = companyGroupsOf(ROWS);
  assert.equal(parseCompanyGroup("Eva", groups), "Eva");
  assert.equal(parseCompanyGroup("Zuzana", groups), null);
  assert.equal(parseCompanyGroup(null, groups), null);
  assert.equal(companyGroupKey(" Eva@Example.com "), "hugo.companyGroup.v1.eva@example.com");
});
