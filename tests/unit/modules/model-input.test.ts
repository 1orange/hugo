import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitLinesToCharBudget,
  OMITTED_LINES_MARKER,
  trimLinesForModel,
} from "../../../src/modules/model-input.ts";

// Omega prints the customer's block twice and its footer on every page.
test("a repeated address or footer is read once", () => {
  assert.deepEqual(
    trimLinesForModel([
      "ABC Development s. r. o.",
      "Rajecká 8687/34",
      "",
      "ABC Development s. r. o.",
      "Rajecká 8687/34",
      "Vytvorené v programe OMEGA - podvojné účtovníctvo",
      "",
      "Vytvorené v programe OMEGA - podvojné účtovníctvo",
    ]),
    ["ABC Development s. r. o.", "Rajecká 8687/34", "", "Vytvorené v programe OMEGA - podvojné účtovníctvo"],
  );
});

test("a short line may repeat: in a table it is a cell", () => {
  assert.deepEqual(trimLinesForModel(["23 %", "231,00", "23 %", "227,50"]), ["23 %", "231,00", "23 %", "227,50"]);
});

test("a spelled-out page number goes; a bare number stays, it may be a rate", () => {
  assert.deepEqual(trimLinesForModel(["Strana 1 z 2", "1/2", "Page 2 of 2", "23", "Celkom | 563,96"]), [
    "23",
    "Celkom | 563,96",
  ]);
});

test("blank lines collapse to one and none are left at the ends", () => {
  assert.deepEqual(trimLinesForModel(["", "Dodávateľ:", "", "", "Odberateľ:", ""]), ["Dodávateľ:", "", "Odberateľ:"]);
});

test("text within the budget is sent whole", () => {
  const lines = ["Faktúra 2026001", "Spolu | 12,30"];
  assert.deepEqual(fitLinesToCharBudget(lines, 1_000), lines);
});

// A loan contract ran 9,550 tokens against an 8,192-token context.
test("a long text keeps its start and its end, and marks the gap", () => {
  const lines = [
    "Faktúra 2026001",
    "Dátum vystavenia: 01.05.2026",
    ...Array.from({ length: 200 }, (_, index) => `Položka ${index} | 1 ks | 10,00`),
    "Spolu k úhrade | 2 000,00",
  ];
  const fitted = fitLinesToCharBudget(lines, 300);
  assert.ok(fitted.join("\n").length <= 300);
  assert.deepEqual(fitted.slice(0, 2), ["Faktúra 2026001", "Dátum vystavenia: 01.05.2026"]);
  assert.equal(fitted.at(-1), "Spolu k úhrade | 2 000,00");
  assert.equal(fitted.filter((line) => line === OMITTED_LINES_MARKER).length, 1);
  assert.ok(fitted.indexOf(OMITTED_LINES_MARKER) > 2);
});
