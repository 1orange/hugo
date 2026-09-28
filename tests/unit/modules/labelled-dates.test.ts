import { test } from "node:test";
import assert from "node:assert/strict";
import { isLabelledOnlyAsDue, labelledDates } from "../../../src/modules/labelled-dates.ts";

// Bonami's invoice, as the model reads it.
const BONAMI = [
  "Dátum vystavenia: | 03.05.2026",
  "Dátum splatnosti: | 17.05.2026",
  "Dátum daňovej povinnosti: | 03.05.2026",
];

test("dates are read with the label printed before them", () => {
  const labels = labelledDates(BONAMI);
  assert.deepEqual([...labels.get("2026-05-03")!].sort(), ["issue", "taxable"]);
  assert.deepEqual([...labels.get("2026-05-17")!], ["due"]);
});

test("a date printed only as the due date is not the taxable supply date", () => {
  const labels = labelledDates(BONAMI);
  assert.equal(isLabelledOnlyAsDue("2026-05-17", labels), true);
  assert.equal(isLabelledOnlyAsDue("2026-05-03", labels), false);
  assert.equal(isLabelledOnlyAsDue(null, labels), false);
});

// A cash invoice: issued, supplied and due the same day.
test("one date under all three labels is not flagged", () => {
  const labels = labelledDates([
    "IČO: 45891761 | Dátum vyhotovenia: | 15.05.2026",
    "DIČ: 2023141351 | Dodanie tovaru/služby: | 15.05.2026",
    "IČ DPH: SK2023141351 | Dátum splatnosti: | 15.05.2026",
  ]);
  assert.equal(isLabelledOnlyAsDue("2026-05-15", labels), false);
});

test("several labels on one line each take their own date; Czech and OCR text too", () => {
  const labels = labelledDates([
    "Datum vystavení: 1.5.2026 | Datum splatnosti: 15. 5. 2026 | DUZP: 30.4.2026",
    "Datum splatnosti 20.05.2026",
  ]);
  assert.deepEqual([...labels.get("2026-05-01")!], ["issue"]);
  assert.deepEqual([...labels.get("2026-05-15")!], ["due"]);
  assert.deepEqual([...labels.get("2026-04-30")!], ["taxable"]);
  assert.deepEqual([...labels.get("2026-05-20")!], ["due"]);
});

test("without a label for another date, nothing is flagged", () => {
  const labels = labelledDates(["Splatnosť: 17.05.2026", "Spolu 12,00 EUR"]);
  assert.equal(isLabelledOnlyAsDue("2026-05-17", labels), false);
});
