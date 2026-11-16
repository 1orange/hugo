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
  selectAdresarWrites,
  selectClientSheetWrites,
  tickKey,
  type ClientSheetPlan,
  type ClientSheetRow,
  type MatchCompany,
  type MatchSubject,
  type SheetFacts,
} from "../../../src/modules/client-sheet.ts";
import type { ColumnKey } from "../../../src/modules/client-sheet.ts";
import {
  FIXTURE_COMPANIES,
  FIXTURE_CSV,
  FIXTURE_HEADERS,
  FIXTURE_ROWS,
  FIXTURE_SUBJECTS,
  csvText,
} from "../support/client-sheet-fixture.ts";

const COMPANIES: MatchCompany[] = FIXTURE_COMPANIES;
const SUBJECTS: MatchSubject[] = FIXTURE_SUBJECTS;

function parsedRows(text: string): ClientSheetRow[] {
  const parsed = parseClientSheet(text);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  return parsed.rows;
}

function factsFrom(cells: Partial<Record<ColumnKey, string>>): SheetFacts {
  const [row] = parsedRows(csvText(FIXTURE_HEADERS, [{ client: "Test", ...cells }]));
  return readFacts(row!);
}

function fixturePlan(): ClientSheetPlan {
  return planClientSheet(parsedRows(FIXTURE_CSV), COMPANIES, SUBJECTS);
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
    subjects?: MatchSubject[];
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
      subjects: [...SUBJECTS, { ...SUBJECTS[2]!, id: 109, linkedCompanyId: 9 }],
      expected: "ambiguous-ico",
    },
    {
      name: "an IČO held by an Adresár subject that no company links does not name a company",
      cells: { client: "Neznáma", ico: "36000001" },
      subjects: [...SUBJECTS, { ...SUBJECTS[2]!, id: 110, ico: "36000001", linkedCompanyId: null, officeClient: true }],
      expected: "unmatched",
    },
  ];

  for (const c of cases) {
    const facts = factsFrom({ client: "Test", ...c.cells });
    const result = matchRow(facts, c.companies ?? COMPANIES, c.subjects ?? SUBJECTS);
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
  assert.deepEqual(
    alfa.officeChanges.map((change) => [change.field, change.old, change.next]),
    [
      ["keeper", "", "Eva"],
      ["cooperation", "", "aktívna"],
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

  // Zeta's identity agrees with the sheet, but the office data is new: the row is changed, with no identity field.
  const zeta = rowOf(plan, 5);
  assert.equal(zeta.status, "changed");
  assert.deepEqual(zeta.fields, []);
  assert.deepEqual(zeta.officeChanges.map((change) => change.field), ["keeper", "cooperation"]);

  const neznama = rowOf(plan, 6);
  assert.equal(neznama.status, "unmatched");
  assert.equal(neznama.companyId, null);
  assert.ok(neznama.reason);

  const delta = rowOf(plan, 7);
  assert.equal(delta.status, "adresar");
  assert.equal(delta.companyId, null);
  assert.equal(delta.current, null, "no subject holds the IČO yet");
  assert.equal(delta.companyName, "Delta, s.r.o.");
  assert.deepEqual(
    delta.officeChanges.map((change) => [change.field, change.old, change.next]),
    [
      ["officeClient", null, "áno"],
      ["keeper", null, "Katarína"],
      ["cooperation", null, "aktívna"],
    ],
  );

  assert.deepEqual(
    {
      new: plan.counts.new,
      changed: plan.counts.changed,
      unchanged: plan.counts.unchanged,
      adresar: plan.counts.adresar,
      invalid: plan.counts.invalid,
      unmatched: plan.counts.unmatched,
      guesses: plan.counts.guesses,
      disagreements: plan.counts.disagreements,
    },
    { new: 1, changed: 3, unchanged: 0, adresar: 1, invalid: 1, unmatched: 1, guesses: 1, disagreements: 2 },
  );
});

test("a row without an IČO is matched but not written", () => {
  const plan = planClientSheet(
    parsedRows(csvText(FIXTURE_HEADERS, [{ client: "Alfa", folderId: "folder-alfa", ico: "" }])),
    COMPANIES,
    SUBJECTS,
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
    SUBJECTS,
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
    SUBJECTS,
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

  // Nothing ticked: Alfa's hand-saved address stays, its empty IČ DPH is filled; Gama is filled; the
  // office data of Alfa, Gama and Zeta is written, since the sheet owns it.
  const untouched = writes();
  assert.deepEqual(
    untouched.map((write) => [write.companyId, write.written, write.overwritten, write.office]),
    [
      [1, ["icDph"], [], ["keeper", "cooperation"]],
      [3, ["legalName", "address", "dic", "icDph"], [], ["keeper", "cooperation"]],
      [5, [], [], ["keeper", "cooperation"]],
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
  assert.deepEqual(writes.map((write) => write.companyId), [1, 3, 5], "Zeta is written for its office data only");
  assert.deepEqual(writes[2]!.written, [], "Zeta's identity agrees with the sheet: a tick on it writes nothing");
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

// The Adresár (0006/04): an IČO no company holds. Made-up companies with valid IČOs.
const DELTA = { client: "Delta", officialName: "Delta, s.r.o.", ico: "36000001", seat: "Mierová 3, Žilina", keeper: "Katarína", cooperation: "aktívna", status: "aktívny" };

function planOf(rows: Array<Partial<Record<ColumnKey, string>>>, subjects: MatchSubject[] = SUBJECTS): ClientSheetPlan {
  return planClientSheet(parsedRows(csvText(FIXTURE_HEADERS, rows)), COMPANIES, subjects);
}

/**
 * What the store holds after a write, as the next plan reads it (pure): an identity field the
 * write set takes its value, and the office data takes the sheet's. A new subject is linked only
 * when a company's profile is written.
 */
function subjectsAfter(
  subjects: readonly MatchSubject[],
  profiles: ReturnType<typeof selectClientSheetWrites>,
  adresar: ReturnType<typeof selectAdresarWrites>,
): MatchSubject[] {
  const next: MatchSubject[] = subjects.map((subject) => ({ ...subject }));
  const apply = (subject: MatchSubject, write: { written: string[]; values: Record<string, string>; keeper: string | null; cooperation: string | null; office: string[] }) => {
    for (const field of write.written) {
      if (field === "legalName" || field === "address" || field === "dic" || field === "icDph") {
        subject[field] = write.values[field] ?? "";
      }
    }
    if (write.office.includes("keeper") && write.keeper !== null) subject.officeKeeper = write.keeper;
    if (write.office.includes("cooperation") && write.cooperation !== null) subject.officeCooperation = write.cooperation;
  };
  for (const write of profiles) {
    let subject = next.find((candidate) => candidate.linkedCompanyId === write.companyId);
    if (!subject) {
      subject = next.find((candidate) => candidate.country === "SK" && candidate.ico === write.values.ico);
    }
    if (!subject) {
      subject = { id: 900 + next.length, country: "SK", ico: write.values.ico, linkedCompanyId: null, legalName: "", address: "", dic: "", icDph: "", officeClient: false, officeKeeper: "", officeCooperation: "" };
      next.push(subject);
    }
    subject.linkedCompanyId = write.companyId;
    apply(subject, write);
  }
  for (const write of adresar) {
    let subject = next.find((candidate) => candidate.linkedCompanyId === null && candidate.country === "SK" && candidate.ico === write.ico);
    if (!subject) {
      subject = { id: 900 + next.length, country: "SK", ico: write.ico, linkedCompanyId: null, legalName: "", address: "", dic: "", icDph: "", officeClient: false, officeKeeper: "", officeCooperation: "" };
      next.push(subject);
    }
    subject.officeClient = true;
    apply(subject, write);
  }
  return next;
}

test("a row with an IČO that no company holds goes into the Adresár; a row without one is only reported", () => {
  const plan = planOf([DELTA, { client: "Neznáma", folderId: "folder-nobody" }]);
  const delta = rowOf(plan, 1);
  assert.equal(delta.status, "adresar");
  assert.equal(delta.ico, "36000001");
  assert.equal(delta.companyId, null);
  assert.equal(delta.reason, null);

  const neznama = rowOf(plan, 2);
  assert.equal(neznama.status, "unmatched", "no IČO: it stays only reported");
  assert.equal(plan.counts.adresar, 1);
  assert.equal(plan.counts.unmatched, 1);
});

test("an IČO row whose IČ DPH is malformed is refused, not written to the Adresár", () => {
  const plan = planOf([{ ...DELTA, icDph: "CZ2020000007" }]);
  const row = rowOf(plan, 1);
  assert.equal(row.status, "invalid");
  assert.match(row.reason ?? "", /SK a desať číslic/);
});

test("an existing Adresár subject with the IČO is updated: its empty fields are filled, its other values need a tick", () => {
  const delta: MatchSubject = {
    id: 42,
    country: "SK",
    ico: "36000001",
    linkedCompanyId: null,
    legalName: "Delta Holding, a.s.",
    address: "",
    dic: "",
    icDph: "",
    officeClient: false,
    officeKeeper: "",
    officeCooperation: "",
  };
  const plan = planOf([DELTA], [...SUBJECTS, delta]);
  const row = rowOf(plan, 1);
  assert.equal(row.status, "adresar");
  assert.equal(row.current?.legalName, "Delta Holding, a.s.");
  assert.deepEqual(row.fields.map((change) => [change.field, change.kind]), [
    ["legalName", "change"],
    ["address", "fill"],
  ]);

  const untouched = selectAdresarWrites(plan, { confirmedRows: [], tickedFields: [] });
  assert.deepEqual(untouched.map((write) => [write.isNew, write.written, write.overwritten, write.office]), [
    [false, ["address"], [], ["officeClient", "keeper", "cooperation"]],
  ]);
  assert.equal(untouched[0]!.values.legalName, "Delta Holding, a.s.", "a value she did not tick is kept");

  const ticked = selectAdresarWrites(plan, { confirmedRows: [], tickedFields: [tickKey(1, "legalName")] });
  assert.deepEqual(ticked[0]!.overwritten, ["legalName"]);
  assert.equal(ticked[0]!.values.legalName, "Delta, s.r.o.");
});

test("re-importing the same sheet changes nothing: the second plan writes nothing", () => {
  const rows = parsedRows(FIXTURE_CSV);
  const decisions = { confirmedRows: [2], tickedFields: [] };
  const first = planClientSheet(rows, COMPANIES, SUBJECTS);
  const profiles = selectClientSheetWrites(first, decisions);
  const adresar = selectAdresarWrites(first, decisions);
  assert.equal(adresar.length, 1, "Delta is written once");

  const after = subjectsAfter(SUBJECTS, profiles, adresar);
  const second = planClientSheet(rows, COMPANIES, after);
  assert.deepEqual(selectClientSheetWrites(second, decisions), [], "no company write on the second import");
  assert.deepEqual(selectAdresarWrites(second, decisions), [], "no Adresár write on the second import");
  assert.equal(rowOf(second, 7).status, "unchanged");
  assert.equal(second.counts.adresar, 0);
  assert.equal(rowOf(second, 6).status, "unmatched");
});

test("a new office client's write carries the sheet's keeper, cooperation and the office-client flag", () => {
  const plan = planOf([DELTA]);
  const [write] = selectAdresarWrites(plan, { confirmedRows: [], tickedFields: [] });
  assert.equal(write!.isNew, true);
  assert.equal(write!.keeper, "Katarína");
  assert.deepEqual(write!.office, ["officeClient", "keeper", "cooperation"]);
  assert.equal(write!.values.legalName, "Delta, s.r.o.");
});

test("two rows with one IČO are both refused, since they would write the same subject", () => {
  const plan = planOf([DELTA, { ...DELTA, client: "Delta kópia", officialName: "Delta kópia, s.r.o." }]);
  for (const row of plan.rows) {
    assert.equal(row.status, "invalid");
    assert.match(row.reason ?? "", /IČO 36000001 sa v hárku opakuje/);
  }
});

test("a company whose IČO would move onto another Adresár subject is refused: no values move between subjects", () => {
  const otherSubject: MatchSubject = {
    id: 43,
    country: "SK",
    ico: "36000001",
    linkedCompanyId: null,
    legalName: "Iný subjekt",
    address: "",
    dic: "",
    icDph: "",
    officeClient: false,
    officeKeeper: "",
    officeCooperation: "",
  };
  const plan = planOf([{ client: "Alfa", folderId: "folder-alfa", officialName: "Alfa s.r.o.", ico: "36000001" }], [...SUBJECTS, otherSubject]);
  const row = rowOf(plan, 1);
  assert.equal(row.status, "invalid");
  assert.match(row.reason ?? "", /už má v adresári iný subjekt/);
});

test("a company with no profile yet, whose IČO an Adresár subject holds, is a new profile that links that subject", () => {
  const subject: MatchSubject = {
    id: 44,
    country: "SK",
    ico: "36000001",
    linkedCompanyId: null,
    legalName: "Delta, s.r.o.",
    address: "",
    dic: "",
    icDph: "",
    officeClient: true,
    officeKeeper: "",
    officeCooperation: "",
  };
  const plan = planOf([{ ...DELTA, folderId: "folder-beta" }], [...SUBJECTS, subject]);
  const row = rowOf(plan, 1);
  assert.equal(row.companyId, 2, "matched by folder");
  assert.equal(row.status, "new", "the profile does not exist yet");
  assert.equal(row.current?.legalName, "Delta, s.r.o.");

  const [write] = selectClientSheetWrites(plan, { confirmedRows: [], tickedFields: [] });
  assert.equal(write!.companyId, 2, "written even with nothing to fill, so the subject is linked");
});
