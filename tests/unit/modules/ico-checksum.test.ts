import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidIcoChecksum } from "../../../src/modules/ico-checksum.ts";

// Slovak and Czech IČO: eight digits, the last one a mod-11 check over the
// first seven with weights 8..2. Remainder 0 gives 1, remainder 1 gives 0.
const CASES: Array<[string, boolean, string]> = [
  ["31322832", true, "Slovnaft (remainder 9)"],
  ["50861930", true, "Stanica Nivy s.r.o. (remainder 1, check digit 0)"],
  ["00604381", true, "remainder 0, check digit 1"],
  ["45244782", true, "Česká spořitelna (CZ)"],
  ["25596641", true, "CZ (remainder 0, check digit 1)"],
  ["31333531", false, "check digit 1 where 2 is expected"],
  ["12345678", false, "check digit 8 where 9 is expected"],
  ["87654321", false, "check digit 1 where 6 is expected"],
  ["11111111", false, "check digit 1 where 9 is expected"],
  ["3132283", false, "seven digits"],
  ["313228321", false, "nine digits"],
  ["3132283X", false, "a letter"],
  ["", false, "empty"],
];

for (const [ico, valid, why] of CASES) {
  test(`IČO "${ico}" is ${valid ? "valid" : "invalid"} (${why})`, () => {
    assert.equal(isValidIcoChecksum(ico), valid);
  });
}

test("spaces inside the IČO do not count", () => {
  assert.equal(isValidIcoChecksum("31 322 832"), true);
  assert.equal(isValidIcoChecksum("50 861 930"), true);
  assert.equal(isValidIcoChecksum("31 333 531"), false);
});
