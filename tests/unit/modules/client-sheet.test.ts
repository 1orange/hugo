import { test } from "node:test";
import assert from "node:assert/strict";
import {
  disagreementsFor,
  fieldChanges,
  matchRow,
  normalizeName,
  parseClientSheet,
  parseCsvRecords,
  planClientSheet,
  readFacts,
  selectClientSheetWrites,
  tickKey,
  type ClientSheetRow,
  type MatchCompany,
  type MatchProfile,
  type SheetFacts,
} from "../../../src/modules/client-sheet.ts";
import type { ColumnKey } from "../../../src/modules/client-sheet.ts";
import {
  FIXTURE_COMPANIES,
  FIXTURE_CSV,
  FIXTURE_HEADERS,
  FIXTURE_PROFILES,
  FIXTURE_ROWS,
  csvText,
} from "../support/client-sheet-fixture.ts";

const COMPANIES: MatchCompany[] = FIXTURE_COMPANIES;
const PROFILES: MatchProfile[] = FIXTURE_PROFILES;

function parsedRows(text: string): ClientSheetRow[] {
  const parsed = parseClientSheet(text);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  return parsed.rows;
}

function factsFrom(cells: Partial<Record<ColumnKey, string>>): SheetFacts {
  const [row] = parsedRows(csvText(FIXTURE_HEADERS, [{ client: "Test", ...cells }]));
  return readFacts(row!);
}

function fixturePlan() {
  return planClientSheet(parsedRows(FIXTURE_CSV), COMPANIES, PROFILES);
}

function rowOf(plan: ReturnType<typeof fixturePlan>, rowNumber: number) {
  const row = plan.rows.find((candidate) => candidate.rowNumber === rowNumber);
  assert.ok(row, `row ${rowNumber} is in the plan`);
  return row;
}

test("the CSV records: quotes, doubled quotes, line breaks inside quotes, CRLF, blank lines", () => {
  const cases: Array<{ name: string; text: string; delimiter?: string; expected: string[][] | null }> = [
    { name: "plain records", text: "a,b\n1,2\n", expected: [["a", "b"], ["1", "2"]] },
    { name: "a quoted delimiter stays in its field", text: 'a,"b, c",d\n', expected: [["a", "b, c", "d"]] },
    { name: "a doubled quote is one quote", text: '"say ""hi""",x\n', expected: [['say "hi"', "x"]] },
    { name: "a line break inside quotes stays in the field", text: '"line1\nline2",x\n', expected: [["line1\nline2", "x"]] },
    { name: "CRLF line endings", text: "a,b\r\n1,2\r\n", expected: [["a", "b"], ["1", "2"]] },
    { name: "blank lines are skipped", text: "a\n\n\nb\n", expected: [["a"], ["b"]] },
    { name: "no trailing newline", text: "a,b\n1,2", expected: [["a", "b"], ["1", "2"]] },
    { name: "a semicolon delimiter", text: "a;b\n1;2\n", delimiter: ";", expected: [["a", "b"], ["1", "2"]] },
    { name: "an unclosed quote is refused, not swallowed", text: '"abc,def\n', expected: null },
  ];
  for (const c of cases) {
    assert.deepEqual(parseCsvRecords(c.text, c.delimiter ?? ","), c.expected, c.name);
  }
});

test("the header line decides the delimiter, so a semicolon sheet from Excel reads too", () => {
  const epsilon = FIXTURE_ROWS[3]!;
  const semicolon = csvText(FIXTURE_HEADERS, [epsilon]).replace(/,/g, ";");
  const rows = parsedRows(semicolon);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.cells.ico, "1234567");
  assert.equal(rows[0]!.cells.folderId, "folder-epsilon");
});

test("the columns are found by their Slovak headers in any order, with or without diacritics", () => {
  const reversed = [...FIXTURE_HEADERS].reverse();
  const shuffled = parsedRows(csvText(reversed, [FIXTURE_ROWS[0]!]));
  const ordered = parsedRows(csvText(FIXTURE_HEADERS, [FIXTURE_ROWS[0]!]));
  assert.deepEqual(shuffled[0]!.cells, ordered[0]!.cells);

  const plain = FIXTURE_CSV.replace("Oficiálny názov", "Oficialny nazov").replace("Sídlo", "Sidlo");
  assert.equal(parsedRows(plain)[0]!.cells.seat, "Pod Hradom 2, Bratislava");
});

test("a byte-order mark before the header does not hide its first column", () => {
  assert.equal(parsedRows("﻿" + FIXTURE_CSV)[0]!.cells.client, "Alfa");
});

test("a missing required column is named, all of them when more than one is missing", () => {
  const cases: Array<{ name: string; drop: ColumnKey[]; message: string | null }> = [
    { name: "one column", drop: ["seat"], message: "V tabuľke chýba stĺpec „Sídlo“." },
    { name: "the IČO", drop: ["ico"], message: "V tabuľke chýba stĺpec „IČO“." },
    {
      name: "two columns",
      drop: ["keeper", "cooperation"],
      message: "V tabuľke chýbajú stĺpce: „Vedie“, „Spolupráca“.",
    },
    { name: "an optional column is not required", drop: ["legalForm"], message: null },
  ];
  for (const c of cases) {
    const headers = FIXTURE_HEADERS.filter((key) => !c.drop.includes(key));
    const parsed = parseClientSheet(csvText(headers, [FIXTURE_ROWS[0]!]));
    if (c.message === null) {
      assert.equal(parsed.ok, true, c.name);
    } else {
      assert.deepEqual(parsed, { ok: false, message: c.message }, c.name);
    }
  }
  assert.deepEqual(parseClientSheet(""), { ok: false, message: "Tabuľka je prázdna." });
});

test("a quoted Sídlo keeps its commas and its doubled quotes", () => {
  const rows = parsedRows(csvText(FIXTURE_HEADERS, [{ ...FIXTURE_ROWS[0]!, seat: 'Hlavná 5, "Dvor", Košice' }]));
  assert.equal(rows[0]!.cells.seat, 'Hlavná 5, "Dvor", Košice');
  assert.equal(readFacts(rows[0]!).seat, 'Hlavná 5, "Dvor", Košice');
});

test("a malformed IČO or IČ DPH is reported in the profile form's words; an empty one is not a problem", () => {
  const cases: Array<{
    name: string;
    cells: Partial<Record<ColumnKey, string>>;
    ico: string;
    icDph: string;
    problem: string | null;
  }> = [
    { name: "both empty", cells: { ico: "", icDph: "" }, ico: "", icDph: "", problem: null },
    { name: "a valid IČO", cells: { ico: "12345679" }, ico: "12345679", icDph: "", problem: null },
    { name: "spaces inside the IČO are ignored", cells: { ico: "1234 5679" }, ico: "12345679", icDph: "", problem: null },
    { name: "seven digits", cells: { ico: "1234567" }, ico: "", icDph: "", problem: "nemá osem číslic" },
    { name: "letters", cells: { ico: "12ab5679" }, ico: "", icDph: "", problem: "nemá osem číslic" },
    { name: "a wrong check digit", cells: { ico: "12345678" }, ico: "", icDph: "", problem: "kontrolnú číslicu" },
    { name: "a valid SK IČ DPH", cells: { icDph: "SK2020000001" }, ico: "", icDph: "SK2020000001", problem: null },
    { name: "lower case is normalized", cells: { icDph: "sk2020000001" }, ico: "", icDph: "SK2020000001", problem: null },
    { name: "too few digits", cells: { icDph: "SK123" }, ico: "", icDph: "", problem: "SK a desať číslic" },
    { name: "a Czech VAT number", cells: { icDph: "CZ2020000001" }, ico: "", icDph: "", problem: "SK a desať číslic" },
    { name: "no SK prefix", cells: { icDph: "2020000001" }, ico: "", icDph: "", problem: "SK a desať číslic" },
  ];
  for (const c of cases) {
    const facts = factsFrom(c.cells);
    assert.equal(facts.ico, c.ico, `${c.name}: IČO`);
    assert.equal(facts.icDph, c.icDph, `${c.name}: IČ DPH`);
    if (c.problem === null) {
      assert.deepEqual(facts.problems, [], c.name);
    } else {
      assert.equal(facts.problems.length, 1, c.name);
      assert.match(facts.problems[0]!, new RegExp(c.problem), c.name);
    }
  }
});

test("names match without case, diacritics or spacing", () => {
  const cases: Array<[string, string]> = [
    ["Katarína", "katarina"],
    ["  Alfa   s.r.o. ", "alfa s.r.o."],
    ["Ľudmila Čaro", "ludmila caro"],
    ["Beta Štúdio s.r.o.", "beta studio s.r.o."],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeName(input), expected, input);
  }
});

test("each match path finds its company, and the strongest key wins", () => {
  const cases: Array<{
    name: string;
    cells: Partial<Record<ColumnKey, string>>;
    companies?: MatchCompany[];
    profiles?: MatchProfile[];
    expected: { companyId: number; by: string } | "unmatched" | "ambiguous-name" | "ambiguous-ico";
  }> = [
    {
      name: "the folder id, even when the IČO belongs to another company",
      cells: { folderId: "folder-beta", ico: "12345679" },
      expected: { companyId: 2, by: "folder" },
    },
    {
      name: "the IČO of an existing profile, when there is no folder id",
      cells: { ico: "12345679" },
      expected: { companyId: 1, by: "ico" },
    },
    {
      name: "the IČO when the folder id names no company",
      cells: { folderId: "folder-nobody", ico: "30000009" },
      expected: { companyId: 5, by: "ico" },
    },
    {
      name: "the name without diacritics or case, against the display name",
      cells: { client: "BETA STUDIO S.R.O." },
      expected: { companyId: 2, by: "name" },
    },
    {
      name: "the name as Drive has it, with its Doklady prefix",
      cells: { client: "Doklady Gama, a.s." },
      expected: { companyId: 3, by: "name" },
    },
    {
      name: "nothing matches",
      cells: { folderId: "folder-nobody", client: "Neznáma" },
      expected: "unmatched",
    },
    {
      name: "a name that two companies share is not guessed",
      cells: { client: "Beta Štúdio s.r.o." },
      companies: [
        ...COMPANIES,
        { id: 9, driveFolderId: "folder-dup", name: "Doklady Beta Štúdio s.r.o.", groupName: null, archived: false },
      ],
      expected: "ambiguous-name",
    },
    {
      name: "an IČO that two profiles hold is not guessed",
      cells: { ico: "30000009" },
      profiles: [...PROFILES, { companyId: 9, country: "SK", legalName: "", address: "", ico: "30000009", dic: "", icDph: "" }],
      expected: "ambiguous-ico",
    },
  ];

  for (const c of cases) {
    const facts = factsFrom({ client: "Test", ...c.cells });
    const result = matchRow(facts, c.companies ?? COMPANIES, c.profiles ?? PROFILES);
    if (c.expected === "unmatched") {
      assert.ok("reason" in result, c.name);
    } else if (c.expected === "ambiguous-name") {
      assert.ok("reason" in result && result.reason.includes("viacero"), c.name);
    } else if (c.expected === "ambiguous-ico") {
      assert.ok("reason" in result && result.reason.includes("viacerým"), c.name);
    } else {
      assert.deepEqual(result, c.expected, c.name);
    }
  }
});

test("the disagreements: Vedie against the Drive group, ukončená outside the archive, zaniknutý while active", () => {
  const company = { id: 1, driveFolderId: "f", name: "Doklady Test s.r.o.", groupName: "Eva", archived: false };
  const cases: Array<{ name: string; cells: Partial<Record<ColumnKey, string>>; company?: Partial<MatchCompany>; expected: string[] }> = [
    { name: "everything agrees", cells: { keeper: "Eva", cooperation: "aktívna", status: "aktívny" }, expected: [] },
    { name: "Vedie is compared without case", cells: { keeper: "eva" }, expected: [] },
    {
      name: "Vedie differs from the Drive group",
      cells: { keeper: "Katarína" },
      expected: ["Vedie „Katarína“, na Drive je v skupine „Eva“."],
    },
    {
      name: "Vedie with no group on Drive",
      cells: { keeper: "Eva" },
      company: { groupName: null },
      expected: ["Vedie „Eva“, ale firma nie je v skupine na Drive."],
    },
    {
      name: "ukončená, but not archived",
      cells: { cooperation: "ukončená" },
      expected: ["Spolupráca je ukončená, ale firma nie je v archíve (skupina Archív)."],
    },
    {
      name: "ukončená and archived agree",
      cells: { cooperation: "ukončená" },
      company: { archived: true, groupName: "Archív" },
      expected: [],
    },
    {
      name: "zaniknutý while aktívna",
      cells: { status: "zaniknutý 01.05.2026", cooperation: "aktívna" },
      expected: ["Stav subjektu je zaniknutý, ale spolupráca je aktívna."],
    },
    {
      name: "zaniknutý with ukončená is consistent",
      cells: { status: "zaniknutý 01.05.2026", cooperation: "ukončená" },
      company: { archived: true, groupName: "Archív" },
      expected: [],
    },
    {
      name: "pozastavený is not zaniknutý",
      cells: { status: "pozastavený do 31.01.2027", cooperation: "aktívna" },
      expected: [],
    },
  ];
  for (const c of cases) {
    const facts = factsFrom({ client: "Test", keeper: "", cooperation: "", status: "", ...c.cells });
    assert.deepEqual(disagreementsFor(facts, { ...company, ...c.company }), c.expected, c.name);
  }
});

test("a profile value she saved is a change, an empty one a fill, the same value nothing", () => {
  const facts = factsFrom({ officialName: "Alfa, s.r.o.", seat: "Pod Hradom 1, Bratislava", dic: "2020000001" });
  const current = {
    country: "SK",
    legalName: "Alfa s.r.o.",
    address: "Pod Hradom 1, Bratislava",
    ico: "",
    dic: "",
    icDph: "",
  };
  const changes = fieldChanges(facts, current).map((change) => [change.field, change.kind]);
  assert.deepEqual(changes, [
    ["legalName", "change"],
    ["dic", "fill"],
  ]);
});

test("the plan: changed, new as a guess, fills only, malformed, unchanged, unmatched; no write is decided yet", () => {
  const plan = fixturePlan();

  const alfa = rowOf(plan, 1);
  assert.equal(alfa.status, "changed");
  assert.equal(alfa.companyId, 1);
  assert.equal(alfa.matchedBy, "folder");
  assert.equal(alfa.guess, false);
  assert.deepEqual(
    alfa.fields.map((change) => [change.field, change.kind, change.old, change.next]),
    [
      ["address", "change", "Pod Hradom 1, Bratislava", "Pod Hradom 2, Bratislava"],
      ["icDph", "fill", "", "SK2020000001"],
    ],
  );

  const beta = rowOf(plan, 2);
  assert.equal(beta.status, "new");
  assert.equal(beta.companyId, 2);
  assert.equal(beta.matchedBy, "name");
  assert.equal(beta.guess, true);
  assert.deepEqual(beta.fields.map((change) => change.field), ["legalName", "address", "ico", "dic", "country"]);
  assert.deepEqual(beta.disagreements, ["Vedie „Eva“, na Drive je v skupine „Katarína“."]);

  const gama = rowOf(plan, 3);
  assert.equal(gama.status, "changed");
  assert.deepEqual(gama.fields.map((change) => [change.field, change.kind]), [
    ["legalName", "fill"],
    ["address", "fill"],
    ["dic", "fill"],
    ["icDph", "fill"],
  ]);
  assert.deepEqual(gama.disagreements, []);

  const epsilon = rowOf(plan, 4);
  assert.equal(epsilon.status, "invalid");
  assert.match(epsilon.reason ?? "", /nemá osem číslic/);
  assert.deepEqual(epsilon.disagreements, ["Stav subjektu je zaniknutý, ale spolupráca je aktívna."]);

  const zeta = rowOf(plan, 5);
  assert.equal(zeta.status, "unchanged");
  assert.deepEqual(zeta.fields, []);

  const neznama = rowOf(plan, 6);
  assert.equal(neznama.status, "unmatched");
  assert.equal(neznama.companyId, null);
  assert.ok(neznama.reason);

  assert.deepEqual(
    {
      new: plan.counts.new,
      changed: plan.counts.changed,
      unchanged: plan.counts.unchanged,
      invalid: plan.counts.invalid,
      unmatched: plan.counts.unmatched,
      guesses: plan.counts.guesses,
      disagreements: plan.counts.disagreements,
    },
    { new: 1, changed: 2, unchanged: 1, invalid: 1, unmatched: 1, guesses: 1, disagreements: 2 },
  );
});

test("a row without an IČO is matched but not written", () => {
  const plan = planClientSheet(
    parsedRows(csvText(FIXTURE_HEADERS, [{ client: "Alfa", folderId: "folder-alfa", ico: "" }])),
    COMPANIES,
    PROFILES,
  );
  const row = rowOf(plan, 1);
  assert.equal(row.status, "no-ico");
  assert.equal(row.companyId, 1);
  assert.match(row.reason ?? "", /Chýba IČO/);
});

test("an IČO that another company's profile holds makes the row invalid, not a second profile", () => {
  const plan = planClientSheet(
    parsedRows(csvText(FIXTURE_HEADERS, [{ client: "Epsilon", folderId: "folder-epsilon", ico: "12345679" }])),
    COMPANIES,
    PROFILES,
  );
  const row = rowOf(plan, 1);
  assert.equal(row.status, "invalid");
  assert.equal(row.companyId, 4);
  assert.match(row.reason ?? "", /IČO 12345679 už má profil firmy „Alfa s.r.o.“/);
});

test("two rows for one company are both refused, since they would race each other", () => {
  const plan = planClientSheet(
    parsedRows(
      csvText(FIXTURE_HEADERS, [
        { client: "Alfa", folderId: "folder-alfa", ico: "12345679" },
        { client: "Alfa", folderId: "folder-alfa", ico: "" },
      ]),
    ),
    COMPANIES,
    PROFILES,
  );
  for (const row of plan.rows) {
    assert.equal(row.status, "invalid");
    assert.match(row.reason ?? "", /viacerých riadkoch/);
  }
});

test("a change is written only when ticked, a fill always, a guess only when confirmed", () => {
  const plan = fixturePlan();
  const writes = (decisions: { confirmedRows?: number[]; tickedFields?: string[] } = {}) =>
    selectClientSheetWrites(plan, { confirmedRows: decisions.confirmedRows ?? [], tickedFields: decisions.tickedFields ?? [] });

  // Nothing ticked: Alfa's hand-saved address stays, its empty IČ DPH is filled; Gama is filled.
  const untouched = writes();
  assert.deepEqual(
    untouched.map((write) => [write.companyId, write.written, write.overwritten]),
    [
      [1, ["icDph"], []],
      [3, ["legalName", "address", "dic", "icDph"], []],
    ],
  );
  assert.equal(untouched[0]!.values.address, "Pod Hradom 1, Bratislava");
  assert.equal(untouched[0]!.values.legalName, "Alfa s.r.o.");

  // Confirming the guess writes the new profile with every value the sheet gave.
  const confirmed = writes({ confirmedRows: [2] }).find((write) => write.companyId === 2);
  assert.ok(confirmed);
  assert.deepEqual(confirmed.written, ["legalName", "address", "ico", "dic", "country"]);
  assert.equal(confirmed.values.ico, "87654326");
  assert.equal(confirmed.values.icDph, "");

  // Ticking Alfa's address replaces her value; the rest of her profile is kept as it is.
  const ticked = writes({ tickedFields: [tickKey(1, "address")] }).find((write) => write.companyId === 1);
  assert.ok(ticked);
  assert.deepEqual(ticked.written, ["address", "icDph"]);
  assert.deepEqual(ticked.overwritten, ["address"]);
  assert.equal(ticked.values.address, "Pod Hradom 2, Bratislava");
  assert.equal(ticked.values.legalName, "Alfa s.r.o.");
  assert.equal(ticked.values.dic, "2020000001");
});

test("the write values are the sheet's, and a tick for a row that is not changed does nothing", () => {
  const plan = fixturePlan();
  const writes = selectClientSheetWrites(plan, {
    confirmedRows: [],
    tickedFields: [tickKey(5, "address"), tickKey(1, "legalName"), tickKey(9, "dic")],
  });
  assert.deepEqual(writes.map((write) => write.companyId), [1, 3], "Zeta, unchanged, is never written");
  assert.equal(writes[0]!.values.legalName, "Alfa s.r.o.", "a tick on an unchanged field writes nothing");
  assert.equal(writes[0]!.values.address, "Pod Hradom 1, Bratislava");

  const gama = writes[1]!.values;
  assert.deepEqual(gama, {
    country: "SK",
    legalName: "Gama, a.s.",
    address: "Mlynská 1, Trnava",
    ico: "50000004",
    dic: "2020000003",
    icDph: "SK2020000003",
  });
});
