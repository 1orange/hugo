import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EKASA_OKP_PATTERN,
  EKASA_UID_PATTERN,
  isValidEkasaOkp,
  isValidEkasaUid,
} from "../../../src/modules/ekasa-identifiers.ts";

test("EKASA_UID_PATTERN accepts O and V prefixes", () => {
  assert.match("O-11111111111111111111111111111111", EKASA_UID_PATTERN);
  assert.match("V-BC7F76A1766A4902BF76A1766AA9024E", EKASA_UID_PATTERN);
  assert.doesNotMatch("O-TOOSHORT", EKASA_UID_PATTERN);
});

test("EKASA_OKP_PATTERN accepts grouped hex", () => {
  assert.match(
    "AAAA1111-22222222-33333333-44444444-55555555",
    EKASA_OKP_PATTERN,
  );
  assert.doesNotMatch("AAAA1111-2222", EKASA_OKP_PATTERN);
});

test("isValidEkasaUid trims whitespace", () => {
  assert.equal(
    isValidEkasaUid(" O-11111111111111111111111111111111 "),
    true,
  );
});

test("isValidEkasaOkp trims whitespace", () => {
  assert.equal(
    isValidEkasaOkp(" AAAA1111-22222222-33333333-44444444-55555555 "),
    true,
  );
});
