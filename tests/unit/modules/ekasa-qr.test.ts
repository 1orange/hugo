import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ekasaReceiptHasAmount,
  parseEkasaQr,
} from "../../../src/modules/ekasa-qr.ts";

const SAMPLE_OKP = "C44B3977-0E415CC6-EE663AA1-776C973A-A143B660";
const SAMPLE_REGISTER = "99920045678900001";
const SAMPLE_TIMESTAMP = "180213093414";
const SAMPLE_SEQUENCE = "23";
const SAMPLE_AMOUNT = "237.23";

test("parseEkasaQr parses colon-separated composite payloads", () => {
  const payload = [
    SAMPLE_OKP,
    SAMPLE_REGISTER,
    SAMPLE_TIMESTAMP,
    SAMPLE_SEQUENCE,
    SAMPLE_AMOUNT,
  ].join(":");

  const parsed = parseEkasaQr(payload);
  assert.equal("variant" in parsed, true);
  if (!("variant" in parsed)) {
    return;
  }

  assert.equal(parsed.variant, "composite");
  if (parsed.variant !== "composite") {
    return;
  }

  assert.equal(parsed.okp, SAMPLE_OKP);
  assert.equal(parsed.registerCode, SAMPLE_REGISTER);
  assert.equal(parsed.timestamp.raw, SAMPLE_TIMESTAMP);
  assert.equal(parsed.sequenceNumber, SAMPLE_SEQUENCE);
  assert.equal(parsed.amountLiteral, SAMPLE_AMOUNT);
  assert.equal(parsed.amountCents, 23723);
  assert.equal(parsed.receiptAtUtc, "2018-02-13T08:34:14.000Z");
});

test("parseEkasaQr parses concatenated composite payloads", () => {
  const payload =
    SAMPLE_OKP + SAMPLE_REGISTER + SAMPLE_TIMESTAMP + "9" + "0.07";
  const parsed = parseEkasaQr(payload);
  assert.equal("variant" in parsed && parsed.variant === "composite", true);
  if ("variant" in parsed && parsed.variant === "composite") {
    assert.equal(parsed.sequenceNumber, "9");
    assert.equal(parsed.amountLiteral, "0.07");
    assert.equal(parsed.amountCents, 7);
  }
});

test("parseEkasaQr accepts composite field-length boundaries", () => {
  const minRegister = "1".repeat(16);
  const maxRegister = "1".repeat(17);
  const minSequence = "1";
  const maxSequence = "123456";
  const minAmount = "0.07";
  const maxAmount = "123456789.12";

  for (const registerCode of [minRegister, maxRegister]) {
    for (const sequenceNumber of [minSequence, maxSequence]) {
      for (const amountLiteral of [minAmount, maxAmount]) {
        const payload = [
          SAMPLE_OKP,
          registerCode,
          "260729120000",
          sequenceNumber,
          amountLiteral,
        ].join(":");
        const parsed = parseEkasaQr(payload);
        assert.equal(
          "variant" in parsed && parsed.variant === "composite",
          true,
          `${registerCode.length}/${sequenceNumber.length}/${amountLiteral}`,
        );
      }
    }
  }
});

test("parseEkasaQr parses UID payloads", () => {
  const payload = "O-7DBCDA8A56EE426DBCDA8A56EE426D1A";
  const parsed = parseEkasaQr(payload);
  assert.deepEqual(parsed, {
    variant: "uid",
    uid: payload,
    payload,
  });
  assert.equal(ekasaReceiptHasAmount(parsed), false);
});

test("parseEkasaQr accepts V-prefixed offline UID payloads", () => {
  const payload = "V-BC7F76A1766A4902BF76A1766AA9024E";
  const parsed = parseEkasaQr(payload);
  assert.equal("variant" in parsed && parsed.variant === "uid", true);
});

test("parseEkasaQr rejects malformed payloads without partial results", () => {
  const cases = [
    "O-TOOSHORT",
    "X-12345678901234567890123456789012",
    `${SAMPLE_OKP}:bad`,
    `${SAMPLE_OKP}:${SAMPLE_REGISTER}:${SAMPLE_TIMESTAMP}:${SAMPLE_SEQUENCE}`,
    `${SAMPLE_OKP}:${SAMPLE_REGISTER}:${SAMPLE_TIMESTAMP}:${SAMPLE_SEQUENCE}:1.234`,
    `${SAMPLE_OKP}${"0".repeat(16)}${SAMPLE_TIMESTAMP}${SAMPLE_SEQUENCE}${SAMPLE_AMOUNT}${SAMPLE_AMOUNT}`,
  ];

  for (const payload of cases) {
    const parsed = parseEkasaQr(payload);
    assert.equal("ok" in parsed && parsed.ok === false, true, payload);
    assert.match(parsed.reason, /./, payload);
  }
});

test("parseEkasaQr preserves exact amount literals that break floats", () => {
  for (const amountLiteral of ["0.07", "1.10", "123.45"]) {
    const payload = [
      SAMPLE_OKP,
      SAMPLE_REGISTER,
      "260128120000",
      "1",
      amountLiteral,
    ].join(":");
    const parsed = parseEkasaQr(payload);
    assert.equal("variant" in parsed && parsed.variant === "composite", true, amountLiteral);
    if ("variant" in parsed && parsed.variant === "composite") {
      assert.equal(parsed.amountLiteral, amountLiteral);
    }
  }
});

test("parseEkasaQr resolves a late-evening receipt in Bratislava local time", () => {
  const payload = [
    SAMPLE_OKP,
    SAMPLE_REGISTER,
    "260128233000",
    "1",
    "10.00",
  ].join(":");
  const parsed = parseEkasaQr(payload);
  assert.equal("variant" in parsed && parsed.variant === "composite", true);
  if ("variant" in parsed && parsed.variant === "composite") {
    assert.equal(parsed.receiptAtUtc, "2026-01-28T22:30:00.000Z");
  }
});
