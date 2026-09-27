import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportNumberPrefixForMonth,
  formatExportNumber,
  nextExportSequence,
} from "../../../src/modules/export-numbering.ts";

test("exportNumberPrefixForMonth derives HYYMM from month key", () => {
  assert.equal(exportNumberPrefixForMonth("2026_05"), "H2605");
  assert.equal(exportNumberPrefixForMonth("2025_12"), "H2512");
});

test("formatExportNumber pads sequence within the month", () => {
  assert.equal(formatExportNumber("2026_05", 1), "H2605-0001");
  assert.equal(formatExportNumber("2026_05", 42), "H2605-0042");
});

test("nextExportSequence picks max existing plus one within the month", () => {
  assert.equal(
    nextExportSequence(["H2605-0001", "H2605-0003", "H2604-0099"], "2026_05"),
    4,
  );
  assert.equal(nextExportSequence([], "2026_05"), 1);
});
