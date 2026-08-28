import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatEuroFromCents,
  parseEuroAmount,
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

test("parseEuroAmount rejects malformed amounts", () => {
  for (const literal of ["", "1.234", "abc", "1,10", "-5.00", "12345678901.1"]) {
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
