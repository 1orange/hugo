import { test } from "node:test";
import assert from "node:assert/strict";
import {
  homeCurrencyForCountry,
  normalizeSkIcDph,
  registerStatusLabel,
  validateSkIcDph,
} from "../../../src/modules/company-profile.ts";

test("validateSkIcDph requires SK and ten digits", () => {
  assert.equal(validateSkIcDph("").ok, false);
  assert.equal(validateSkIcDph("2020372640").ok, false);
  assert.equal(validateSkIcDph("SK123").ok, false);
  assert.equal(validateSkIcDph("sk1234567890").ok, true);
  assert.equal(validateSkIcDph("SK7120001713").ok, true);
});

test("normalizeSkIcDph uppercases and trims", () => {
  assert.equal(normalizeSkIcDph("  sk1234567890 "), "SK1234567890");
});

test("homeCurrencyForCountry follows profile country", () => {
  assert.equal(homeCurrencyForCountry("SK"), "EUR");
  assert.equal(homeCurrencyForCountry("CZ"), "CZK");
});

test("registerStatusLabel is Slovak", () => {
  assert.equal(registerStatusLabel("active"), "Aktívna");
  assert.equal(registerStatusLabel("dissolved"), "Zaniknutá");
});
