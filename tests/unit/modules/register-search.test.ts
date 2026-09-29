import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegisterSearchHit } from "../../../src/modules/company-profile.ts";
import {
  coreCompanyName,
  formatSkPostalCode,
  longestNameToken,
  normalizeCompanyName,
  rankRegisterHits,
} from "../../../src/modules/register-search.ts";

function hit(legalName: string, status: RegisterSearchHit["status"] = "active"): RegisterSearchHit {
  return { ico: legalName, legalName, address: "", status };
}

test("normalizeCompanyName drops case, diacritics and punctuation", () => {
  assert.equal(normalizeCompanyName("SPRING.etc., spol. s r. o."), "spring etc spol s r o");
  assert.equal(normalizeCompanyName("Ľubica Špringelová"), "lubica springelova");
});

test("coreCompanyName drops the legal form wherever it stands", () => {
  assert.equal(coreCompanyName("SPRING.etc., spol. s r. o."), "spring etc");
  assert.equal(coreCompanyName("SPRING,s.r.o. v likvidácii"), "spring");
  assert.equal(coreCompanyName("SLOVNAFT, a.s."), "slovnaft");
});

test("longestNameToken is the longest word of three letters or more", () => {
  assert.equal(longestNameToken("spring etc"), "spring");
  assert.equal(longestNameToken("SPRING.etc., spol. s r. o."), "spring");
  assert.equal(longestNameToken("ab"), null);
});

test("formatSkPostalCode writes five digits as three and two", () => {
  assert.equal(formatSkPostalCode("84105"), "841 05");
  assert.equal(formatSkPostalCode("831 06"), "831 06");
  assert.equal(formatSkPostalCode(""), "");
});

test("rankRegisterHits puts a live company whose first word is the query above longer words", () => {
  const ranked = rankRegisterHits("spring", [
    hit("Ing. Jaroslav Kuliška SPRING"),
    hit("SpringCom, s. r. o."),
    hit("SPRING spol. s r.o.", "dissolved"),
    hit("SPRING.etc., spol. s r. o."),
    hit("TOPSPRING s.r.o."),
    hit("SPRiNG, s. r. o."),
  ]);
  assert.deepEqual(
    ranked.map((entry) => entry.legalName),
    [
      "SPRiNG, s. r. o.",
      "SPRING.etc., spol. s r. o.",
      "SpringCom, s. r. o.",
      "Ing. Jaroslav Kuliška SPRING",
      "TOPSPRING s.r.o.",
      "SPRING spol. s r.o.",
    ],
  );
});

test("rankRegisterHits finds the company by every word of a query the register took by one", () => {
  const ranked = rankRegisterHits("spring etc", [
    hit("R2K s. r. o."),
    hit("SPRING WATER, s.r.o."),
    hit("SPRING.etc., spol. s r. o."),
  ]);
  assert.deepEqual(
    ranked.map((entry) => entry.legalName),
    // R2K was "spring media": matched by a former name, it shares no word.
    ["SPRING.etc., spol. s r. o.", "SPRING WATER, s.r.o.", "R2K s. r. o."],
  );
});

test("rankRegisterHits puts a hit matched only by a former name last among the live", () => {
  const ranked = rankRegisterHits("spring", [hit("Language Siesta - firemné kurzy, s.r.o."), hit("Spring Tatry, s.r.o.")]);
  assert.equal(ranked[0]!.legalName, "Spring Tatry, s.r.o.");
});
