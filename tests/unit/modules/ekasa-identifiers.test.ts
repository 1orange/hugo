import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EKASA_OKP_PATTERN,
  EKASA_UID_PATTERN,
  findEkasaUidInLines,
  findEkasaUidInText,
  isValidEkasaOkp,
  isValidEkasaUid,
  pickEkasaUidFromQrPayloads,
  validateEkasaUidInput,
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

test("validateEkasaUidInput refuses malformed UIDs in Slovak", () => {
  const bad = validateEkasaUidInput("O-TOOSHORT");
  assert.equal(bad.ok, false);
  if (bad.ok) {
    assert.fail();
  }
  assert.match(bad.message, /32 hexadecimálnymi/);

  const good = validateEkasaUidInput("v-bc7f76a1766a4902bf76a1766aa9024e");
  assert.equal(good.ok, true);
  if (!good.ok) {
    assert.fail();
  }
  assert.equal(good.uid, "V-BC7F76A1766A4902BF76A1766AA9024E");
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

test("findEkasaUidInLines finds UID glued before OKP", () => {
  const uid = "V-BC7F76A1766A4902BF76A1766AA9024E";
  assert.equal(
    findEkasaUidInLines([`QR payload ${uid}OKP: AAAA1111-22222222-33333333-44444444-55555555`]),
    uid,
  );
});

test("findEkasaUidInLines rejects near-miss UIDs", () => {
  assert.equal(findEkasaUidInLines(["O-TOOSHORT"]), null);
  assert.equal(findEkasaUidInLines(["marketing https://example.com"]), null);
});

test("pickEkasaUidFromQrPayloads ignores marketing and PAY by square", () => {
  const uid = "V-BC7F76A1766A4902BF76A1766AA9024E";
  assert.deepEqual(
    pickEkasaUidFromQrPayloads([
      "https://slovnaft.sk/move",
      `SPD*1.0*ACC:CZ6855100000001234567890*AM:0.00*CC:EUR*X-VS:123`,
      `${uid}OKP: AAAA1111-22222222-33333333-44444444-55555555`,
    ]),
    { status: "found", uid },
  );
});

test("pickEkasaUidFromQrPayloads flags two different UIDs", () => {
  const result = pickEkasaUidFromQrPayloads([
    "O-11111111111111111111111111111111",
    "O-22222222222222222222222222222222",
  ]);
  assert.equal(result.status, "conflict");
});

test("findEkasaUidInText matches UID inside QR payload", () => {
  const uid = "O-11111111111111111111111111111111";
  assert.equal(findEkasaUidInText(`prefix ${uid} suffix`), uid);
});
