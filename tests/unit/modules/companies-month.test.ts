import { test } from "node:test";
import assert from "node:assert/strict";
import { OPEN_MONTHS_PARAM, resolveCompaniesMonth } from "../../../src/modules/companies-month.ts";

const NOVEMBER = new Date("2026-11-23T11:00:00.000Z");
const JANUARY = new Date("2027-01-02T10:00:00.000Z");

test("Firmy without a month opens on the booking month, for every company", () => {
  assert.equal(resolveCompaniesMonth(undefined, [], NOVEMBER), "2026_10");
  assert.equal(resolveCompaniesMonth(undefined, ["2026_01"], NOVEMBER), "2026_10");
  // January books the previous December.
  assert.equal(resolveCompaniesMonth(undefined, [], JANUARY), "2026_12");
});

test("a bare visit and an empty or unknown value open on the booking month", () => {
  assert.equal(resolveCompaniesMonth("", [], NOVEMBER), "2026_10");
  assert.equal(resolveCompaniesMonth("garbage", [], NOVEMBER), "2026_10");
  assert.equal(resolveCompaniesMonth("2026-10", [], NOVEMBER), "2026_10");
});

test("the open-months option is its own value and shows each company's open month", () => {
  assert.equal(OPEN_MONTHS_PARAM, "open");
  assert.equal(resolveCompaniesMonth("open", ["2026_01", "2026_10"], NOVEMBER), null);
  assert.equal(resolveCompaniesMonth("open", [], JANUARY), null);
});

test("a picked month that some company has is shown as picked", () => {
  assert.equal(resolveCompaniesMonth("2026_01", ["2026_01", "2026_10"], NOVEMBER), "2026_01");
});

test("the booking month is shown even when no company has it yet", () => {
  assert.equal(resolveCompaniesMonth("2026_10", ["2026_01"], NOVEMBER), "2026_10");
});

test("a picked month that no company has keeps the open-month view, as before", () => {
  assert.equal(resolveCompaniesMonth("2026_05", ["2026_01", "2026_10"], NOVEMBER), null);
  // A future month is not in the known keys either, so it is treated the same way.
  assert.equal(resolveCompaniesMonth("2026_12", ["2026_01", "2026_10"], NOVEMBER), null);
});
