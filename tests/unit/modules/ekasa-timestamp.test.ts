import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bratislavaLocalToUtcIso,
  expandEkasaYear,
  parseEkasaTimestampRaw,
} from "../../../src/modules/ekasa-timestamp.ts";

test("expandEkasaYear maps two-digit years into 2000–2099", () => {
  assert.equal(expandEkasaYear(0), 2000);
  assert.equal(expandEkasaYear(26), 2026);
  assert.equal(expandEkasaYear(99), 2099);
});

test("parseEkasaTimestampRaw rejects malformed timestamps", () => {
  for (const raw of ["", "26022923300", "261332233000", "260229606000"]) {
    const parsed = parseEkasaTimestampRaw(raw);
    assert.equal("ok" in parsed && parsed.ok === false, true, raw);
  }
});

test("bratislavaLocalToUtcIso resolves winter local time", () => {
  const local = parseEkasaTimestampRaw("260128233000");
  assert.equal("raw" in local, true);
  if ("raw" in local) {
    assert.equal(bratislavaLocalToUtcIso(local), "2026-01-28T22:30:00.000Z");
  }
});

test("bratislavaLocalToUtcIso resolves summer local time", () => {
  const local = parseEkasaTimestampRaw("260729233000");
  assert.equal("raw" in local, true);
  if ("raw" in local) {
    assert.equal(bratislavaLocalToUtcIso(local), "2026-07-29T21:30:00.000Z");
  }
});

test("bratislavaLocalToUtcIso handles DST spring forward boundary", () => {
  const before = parseEkasaTimestampRaw("260328233000");
  assert.equal("raw" in before, true);
  if ("raw" in before) {
    assert.equal(bratislavaLocalToUtcIso(before), "2026-03-28T22:30:00.000Z");
  }

  const after = parseEkasaTimestampRaw("260329233000");
  assert.equal("raw" in after, true);
  if ("raw" in after) {
    assert.equal(bratislavaLocalToUtcIso(after), "2026-03-29T21:30:00.000Z");
  }
});
