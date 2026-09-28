import { test } from "node:test";
import assert from "node:assert/strict";
import { trimLinesForModel } from "../../../src/modules/model-input.ts";

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
