import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cashRoundingCents,
  roundCashTotalCents,
} from "../../../src/modules/cash-rounding.ts";

test("EUR cash totals round to the nearest 5 cents", () => {
  // Endings 1 and 2 go down, 3 and 4 up to 5, 6 and 7 down to 5, 8 and 9 up.
  assert.equal(roundCashTotalCents(121, "EUR"), 120);
  assert.equal(roundCashTotalCents(122, "EUR"), 120);
  assert.equal(roundCashTotalCents(123, "EUR"), 125);
  assert.equal(roundCashTotalCents(124, "EUR"), 125);
  assert.equal(roundCashTotalCents(125, "EUR"), 125);
  assert.equal(roundCashTotalCents(126, "EUR"), 125);
  assert.equal(roundCashTotalCents(127, "EUR"), 125);
  assert.equal(roundCashTotalCents(128, "EUR"), 130);
  assert.equal(roundCashTotalCents(129, "EUR"), 130);
});

test("CZK cash totals round to the nearest whole koruna, half up", () => {
  assert.equal(roundCashTotalCents(9949, "CZK"), 9900);
  assert.equal(roundCashTotalCents(9950, "CZK"), 10000);
  assert.equal(roundCashTotalCents(10020, "CZK"), 10000);
});

test("a refund rounds symmetrically", () => {
  assert.equal(roundCashTotalCents(-1983, "EUR"), -1985);
  assert.equal(roundCashTotalCents(-9950, "CZK"), -10000);
});

test("other currencies have no cash rounding rule", () => {
  assert.equal(roundCashTotalCents(1983, "USD"), null);
  assert.equal(cashRoundingCents({ itemsTotalCents: 1983, payableCents: 1985, currency: "USD" }), null);
});

test("the two real rounded cash receipts are legal roundings", () => {
  // OMV (IMG_3475) and Slovnaft (IMG_4050), both in 04 Bločky_hotovosť.
  assert.equal(cashRoundingCents({ itemsTotalCents: 1983, payableCents: 1985, currency: "EUR" }), 2);
  assert.equal(cashRoundingCents({ itemsTotalCents: 4001, payableCents: 4000, currency: "EUR" }), -1);
});

test("an unrounded total needs no rounding", () => {
  assert.equal(cashRoundingCents({ itemsTotalCents: 1101, payableCents: 1101, currency: "EUR" }), 0);
});

test("a difference that is not the legal rounding is rejected", () => {
  // 19.83 rounds to 19.85, so 19.80 is a misread or a mismatch, not rounding.
  assert.equal(cashRoundingCents({ itemsTotalCents: 1983, payableCents: 1980, currency: "EUR" }), null);
  assert.equal(cashRoundingCents({ itemsTotalCents: 1983, payableCents: 1990, currency: "EUR" }), null);
  assert.equal(cashRoundingCents({ itemsTotalCents: 9960, payableCents: 9900, currency: "CZK" }), null);
});

test("currency codes are matched case-insensitively", () => {
  assert.equal(cashRoundingCents({ itemsTotalCents: 9960, payableCents: 10000, currency: "czk" }), 40);
});
