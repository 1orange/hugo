import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesSubjectSearch,
  searchSubjects,
  type SearchableSubject,
} from "../../../src/modules/subject-search.ts";

function subject(overrides: Partial<SearchableSubject> & { id: number }): SearchableSubject {
  return {
    legalName: null,
    formerNames: [],
    aliases: [],
    ico: null,
    dic: null,
    icDph: null,
    vatId: null,
    ...overrides,
  };
}

const SLOVNAFT = subject({
  id: 1,
  legalName: "Slovnaft, a. s.",
  formerNames: ["Slovnaft Bratislava, a. s."],
  aliases: ["SLOVNAFT a.s.", "Slovnaft"],
  ico: "31322832",
  dic: "2020322832",
  icDph: "SK2020322832",
  vatId: "SK2020322832",
});
const CENTRAL = subject({
  id: 2,
  legalName: "Centrálny žihadlo, s. r. o.",
  aliases: ["CENTRAL Bratislava"],
  ico: "35757442",
  dic: "2020357574",
  icDph: null,
});
const CZ_GAMMA = subject({
  id: 3,
  legalName: "Gamma s.r.o.",
  ico: "31333532",
  dic: "CZ31333532",
  icDph: "CZ31333532",
  vatId: "CZ31333532",
});

test("an empty query matches every subject", () => {
  assert.equal(matchesSubjectSearch(SLOVNAFT, ""), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "   "), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, null), true);
});

test("the name matches ignoring case, diacritics, punctuation and spacing", () => {
  assert.equal(matchesSubjectSearch(SLOVNAFT, "slovnaft"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "SLOVNAFT"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "Slovnaft, a. s."), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "slovnaft as"), true, "spacing around the legal form does not matter");
  assert.equal(matchesSubjectSearch(CENTRAL, "centralny"), true, "a diacritic in the name is optional in the query");
  assert.equal(matchesSubjectSearch(CENTRAL, "CENTRÁLNY"), true);
  assert.equal(matchesSubjectSearch(CENTRAL, "centraln zihad"), false, "every word must be typed as it is spelt");
});

test("a former name is searched like the current one", () => {
  assert.equal(matchesSubjectSearch(SLOVNAFT, "slovnaft bratislava"), true);
});

test("an alias finds the subject it was printed under", () => {
  assert.equal(matchesSubjectSearch(CENTRAL, "central bratislava"), true);
  assert.equal(matchesSubjectSearch(CENTRAL, "CENTRAL BRATISLAVA"), true);
  assert.equal(matchesSubjectSearch(CENTRAL, "bratislava central"), false);
});

test("an IČO matches with or without spaces in the query", () => {
  assert.equal(matchesSubjectSearch(SLOVNAFT, "31322832"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "31 322 832"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "3132 2832"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "31322833"), false);
});

test("a DIČ matches with or without spaces, and without its country prefix", () => {
  assert.equal(matchesSubjectSearch(SLOVNAFT, "2020322832"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "2020 322 832"), true);
  assert.equal(matchesSubjectSearch(CZ_GAMMA, "CZ 31333532"), true);
});

test("an IČ DPH matches with or without its prefix and spaces, in any case", () => {
  assert.equal(matchesSubjectSearch(SLOVNAFT, "SK2020322832"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "sk 2020 322 832"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "SK 2020322832"), true);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "SK2020322899"), false);
});

test("letters alone do not match an identifier", () => {
  assert.equal(matchesSubjectSearch(CENTRAL, "SK"), false);
  assert.equal(matchesSubjectSearch(SLOVNAFT, "SK"), false, "letters alone never match a number");
});

test("a short number does not match every identifier that contains it", () => {
  assert.equal(matchesSubjectSearch(SLOVNAFT, "20"), false, "fewer than three digits are not an identifier search");
});

test("searchSubjects keeps the input order and reports every match even past the cap", () => {
  const many = Array.from({ length: 5 }, (_, index) =>
    subject({ id: index + 10, legalName: `Test ${index + 1} s.r.o.` }),
  );
  const result = searchSubjects([SLOVNAFT, CENTRAL, CZ_GAMMA, ...many], "s.r.o.", 3);
  assert.equal(result.total, 7);
  assert.deepEqual(result.rows.map((row) => row.id), [2, 3, 10]);
});

test("searchSubjects finds one subject by an identifier among many", () => {
  const result = searchSubjects([SLOVNAFT, CENTRAL, CZ_GAMMA], "CZ31333532", 100);
  assert.deepEqual(result, { rows: [CZ_GAMMA], total: 1 });
});
