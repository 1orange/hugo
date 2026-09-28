import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatEuroFromCents,
  parseEuroAmount,
  parseSignedDecimalAmount,
} from "../../../src/modules/money.ts";

test("parseEuroAmount preserves tricky literals without float drift", () => {
  const cases = [
    { literal: "0.07", cents: 7 },
    { literal: "1.10", cents: 110 },
    { literal: "123.45", cents: 12345 },
    { literal: "123456789.12", cents: 12345678912 },
    { literal: "5", cents: 500 },
    { literal: "5.5", cents: 550 },
  ] as const;

  for (const { literal, cents } of cases) {
    const parsed = parseEuroAmount(literal);
    assert.equal("cents" in parsed, true, literal);
    if ("cents" in parsed) {
      assert.equal(parsed.cents, cents, literal);
      assert.equal(parsed.literal, literal, literal);
    }
  }
});

test("parseEuroAmount accepts a comma separator, as she types it", () => {
  // She works in Slovak, where the decimal separator is a comma. Documents print
  // dots, so both have to parse; the literal keeps whichever arrived.
  for (const { input, cents } of [
    { input: "1,10", cents: 110 },
    { input: "16,85", cents: 1685 },
    { input: "0,07", cents: 7 },
    { input: "1009,00", cents: 100900 },
  ]) {
    const parsed = parseEuroAmount(input);
    assert.equal("cents" in parsed, true, input);
    if ("cents" in parsed) {
      assert.equal(parsed.cents, cents, input);
      assert.equal(parsed.literal, input, "literal should be preserved verbatim");
    }
  }
});

test("parseEuroAmount rejects malformed and ambiguously grouped amounts", () => {
  for (const literal of [
    "",
    "1.234",
    "abc",
    "-5.00",
    "12345678901.1",
    "1,009.00", // thousands grouping: two separators must not be guessed at
    "1.009,00",
    "1,,10",
    "1.10.10",
  ]) {
    const parsed = parseEuroAmount(literal);
    assert.equal("ok" in parsed && parsed.ok === false, true, literal);
  }
});

test("formatEuroFromCents round-trips parsed amounts", () => {
  const parsed = parseEuroAmount("123.45");
  assert.equal("cents" in parsed, true);
  if ("cents" in parsed) {
    assert.equal(formatEuroFromCents(parsed.cents), "123.45");
  }
});

test("an amount read off a credit note keeps its sign", () => {
  assert.deepEqual(parseSignedDecimalAmount("-26.83"), { cents: -2683, literal: "-26.83" });
  assert.deepEqual(parseSignedDecimalAmount("26,83"), { cents: 2683, literal: "26,83" });
  assert.equal("ok" in parseSignedDecimalAmount("--5.00"), true);
  assert.equal("ok" in parseSignedDecimalAmount("-"), true);
});
