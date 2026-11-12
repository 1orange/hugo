import { test } from "node:test";
import assert from "node:assert/strict";
import { companyDisplayName } from "../../../src/modules/company-display-name.ts";

const cases: Array<[label: string, drive: string, expected: string]> = [
  ["strips Konto followed by a space", "Konto SPRING.etc.", "SPRING.etc."],
  ["strips lower-case konto", "konto SPRING.etc.", "SPRING.etc."],
  ["strips upper-case KONTO", "KONTO SPRING.etc.", "SPRING.etc."],
  ["strips mixed case", "kOnTo Beta s.r.o.", "Beta s.r.o."],
  ["leaves a name without the prefix as it is", "SPRING.etc.", "SPRING.etc."],
  ["leaves a legal name without the prefix as it is", "Beta s.r.o.", "Beta s.r.o."],
  ["does not strip Kontohaus (no separating space)", "Kontohaus s.r.o.", "Kontohaus s.r.o."],
  ["does not strip Konto joined to a name", "Konto-SPRING s.r.o.", "Konto-SPRING s.r.o."],
  ["trims extra spaces after the prefix", "Konto    SPRING.etc.", "SPRING.etc."],
  ["trims surrounding whitespace", "   Konto SPRING.etc.   ", "SPRING.etc."],
  ["handles a tab after the prefix", "Konto\tSPRING.etc.", "SPRING.etc."],
  ["handles a non-breaking space after the prefix", "Konto SPRING.etc.", "SPRING.etc."],
  ["strips the prefix once only", "Konto Konto Beta", "Konto Beta"],
  ["keeps a bare Konto as it is", "Konto", "Konto"],
  ["keeps Konto with only trailing whitespace as it is", "Konto   ", "Konto"],
  ["keeps the empty string empty", "", ""],
  ["strips the Doklady prefix the live drive uses", "Doklady Alfa s.r.o.", "Alfa s.r.o."],
  ["strips Doklady in any case", "DOKLADY Beta a.s.", "Beta a.s."],
  ["keeps a bare Doklady as it is", "Doklady", "Doklady"],
  [
    "normalises NFD input to NFC after stripping",
    "Konto Ľubica s.r.o.".normalize("NFD"),
    "Ľubica s.r.o.".normalize("NFC"),
  ],
  [
    "normalises NFD input without the prefix",
    "Špringelová s.r.o.".normalize("NFD"),
    "Špringelová s.r.o.".normalize("NFC"),
  ],
];

for (const [label, drive, expected] of cases) {
  test(`companyDisplayName ${label}`, () => {
    assert.equal(companyDisplayName(drive), expected);
  });
}
