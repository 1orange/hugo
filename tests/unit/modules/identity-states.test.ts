import { test } from "node:test";
import assert from "node:assert/strict";
import {
  identityFieldState,
  identityFieldViews,
  identityRowsOf,
  identitySummary,
  identityStateLabel,
  type IdentityFieldState,
  type IdentitySubject,
} from "../../../src/modules/identity-states.ts";
import {
  applyRegisterFacts,
  icDphConfirmedByVies,
  restoreRegisterValueOf,
  type SubjectSource,
  type SubjectState,
} from "../../../src/modules/subject-directory.ts";

const NOW = "2026-11-16T09:00:00.000Z";
/** The client sheet's source: a value no register confirmed, which the sheet import writes. */
const SHEET: SubjectSource = "sheet";

// The state function, alone: each case is one field with its value, source and the register's answer.
const STATE_CASES: Array<{
  name: string;
  input: Parameters<typeof identityFieldState>[0];
  state: IdentityFieldState;
  registerValue?: string | null;
}> = [
  {
    name: "a value the register says the same as is overené, whoever typed it",
    input: { field: "legalName", value: "Alfa s.r.o.", source: "manual", manual: true, registerValue: "Alfa s.r.o.", answered: true },
    state: "overene",
  },
  {
    name: "a value the register or VIES confirmed is overené",
    input: { field: "address", value: "Bratislava", source: "register", manual: false, registerValue: null, answered: true },
    state: "overene",
  },
  {
    name: "a hand edit that differs from the register is upravené ručne, with the register's value",
    input: { field: "legalName", value: "Alfa Holding s.r.o.", source: "manual", manual: true, registerValue: "Alfa s.r.o.", answered: true },
    state: "upravene-rucne",
    registerValue: "Alfa s.r.o.",
  },
  {
    name: "a hand edit the register holds no value for is upravené ručne, with nothing to return to",
    input: { field: "address", value: "Hlavná 2", source: "manual", manual: true, registerValue: null, answered: true },
    state: "upravene-rucne",
    registerValue: null,
  },
  {
    name: "a hand edit with no register answer at all is neoverené, not a claim of a mismatch",
    input: { field: "legalName", value: "Alfa s.r.o.", source: "manual", manual: true, registerValue: null, answered: false },
    state: "neoverene",
  },
  {
    name: "a hand edit whose register lookup was an outage is neoverené",
    input: { field: "dic", value: "2020311335", source: "manual", manual: true, registerValue: null, answered: false },
    state: "neoverene",
  },
  {
    name: "a sheet value the register confirms is overené",
    input: { field: "legalName", value: "Alfa s.r.o.", source: "sheet", manual: false, registerValue: "Alfa s.r.o.", answered: true },
    state: "overene",
  },
  {
    name: "a sheet value the register does not confirm is neoverené, with the register's value",
    input: { field: "legalName", value: "Alfa Holding s.r.o.", source: "sheet", manual: false, registerValue: "Alfa s.r.o.", answered: true },
    state: "neoverene",
    registerValue: "Alfa s.r.o.",
  },
  {
    name: "a sheet value with no register answer is neoverené",
    input: { field: "address", value: "Bratislava", source: "sheet", manual: false, registerValue: null, answered: false },
    state: "neoverene",
  },
  {
    name: "a value of unknown origin nothing confirms is neoverené",
    input: { field: "dic", value: "2020311335", source: null, manual: false, registerValue: null, answered: false },
    state: "neoverene",
  },
  {
    name: "a cleared hand edit the register holds otherwise is upravené ručne, with the value to return to",
    input: { field: "address", value: null, source: "manual", manual: true, registerValue: "Bratislava, Pribinova 25", answered: true },
    state: "upravene-rucne",
    registerValue: "Bratislava, Pribinova 25",
  },
  {
    name: "a field nothing holds is neoverené",
    input: { field: "address", value: null, source: null, manual: false, registerValue: null, answered: true },
    state: "neoverene",
  },
  {
    name: "a name differing only in case and spacing is the register's name",
    input: { field: "legalName", value: "alfa  s.r.o.", source: "manual", manual: true, registerValue: "Alfa s.r.o.", answered: true },
    state: "overene",
  },
  {
    name: "a DIČ differing only in its country prefix is the register's DIČ",
    input: { field: "dic", value: "SK2020311335", source: "manual", manual: true, registerValue: "2020311335", answered: true },
    state: "overene",
  },
  {
    name: "an IČ DPH differing only in spacing and case is the register's",
    input: { field: "icDph", value: "sk 2020311335", source: "manual", manual: true, registerValue: "SK2020311335", answered: true },
    state: "overene",
  },
];

for (const testCase of STATE_CASES) {
  test(`field state: ${testCase.name}`, () => {
    const result = identityFieldState(testCase.input);
    assert.equal(result.state, testCase.state);
    if (testCase.registerValue !== undefined) {
      assert.equal(result.registerValue, testCase.registerValue);
    }
  });
}

function subject(values: Partial<IdentitySubject> = {}): IdentitySubject {
  return {
    ico: "31333532",
    legalName: "Alfa s.r.o.",
    address: "Bratislava, Pribinova 25",
    dic: "2020311335",
    icDph: null,
    registerStatus: "active",
    sources: { legalName: "register", address: "register", dic: "register" },
    manualFields: [],
    findings: [],
    viesStatus: {},
    ...values,
  };
}

function viewsOf(values: Partial<IdentitySubject>) {
  return Object.fromEntries(identityFieldViews(subject(values)).map((view) => [view.field, view]));
}

test("a subject the register answered, with the register's values, is verified field by field", () => {
  const views = viewsOf({});
  assert.equal(views.legalName!.state, "overene");
  assert.equal(views.address!.state, "overene");
  assert.equal(views.dic!.state, "overene");
  assert.equal(views.ico!.state, "overene", "the IČO the register holds the subject under is verified");
  assert.equal(views.icDph!.state, "neoverene", "no VIES answer for a VAT ID she has not checked");
});

test("a subject no register has found (unknown, not found, or an outage) is unverified; the IČO too", () => {
  const views = viewsOf({ registerStatus: "unknown", sources: { legalName: "sheet" } });
  assert.equal(views.ico!.state, "neoverene");
  assert.equal(views.legalName!.state, "neoverene");
  assert.equal(views.address!.state, "neoverene");
});

test("a hand edit of a found subject shows the register's value beside it, and a manual value equal to it is verified", () => {
  const edited = viewsOf({
    legalName: "Alfa Holding s.r.o.",
    manualFields: ["legalName"],
    sources: { legalName: "manual", address: "register", dic: "register" },
    findings: [{ field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o." }],
  });
  assert.equal(edited.legalName!.state, "upravene-rucne");
  assert.equal(edited.legalName!.registerValue, "Alfa s.r.o.");
  assert.equal(edited.legalName!.manual, true);

  // Typed to equal the register's answer, but not yet checked: unconfirmed, with no value to return to.
  const typedEqual = viewsOf({ legalName: "Alfa s.r.o.", manualFields: ["legalName"], sources: { legalName: "manual" } });
  assert.equal(typedEqual.legalName!.state, "upravene-rucne");
  assert.equal(typedEqual.legalName!.registerValue, null);
});

test("a hand edit the register check then confirms is overené: the check's answer is what makes it so", () => {
  const typedEqual = directoryOf({ legalName: "Alfa s.r.o.", manualFields: ["legalName"], sources: { legalName: "manual" } });
  const update = applyRegisterFacts(typedEqual, FACTS, NOW);
  const views = Object.fromEntries(identityFieldViews(afterUpdate(typedEqual, update)).map((view) => [view.field, view]));
  assert.equal(views.legalName!.state, "overene");
});

test("a sheet value the register has not confirmed is neoverené and not a hand edit", () => {
  const views = viewsOf({
    legalName: "Alfa Holding s.r.o.",
    sources: { legalName: "sheet", address: "register", dic: "register" },
    findings: [{ field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o." }],
  });
  assert.equal(views.legalName!.state, "neoverene");
  assert.equal(views.legalName!.manual, false);
});

test("an IČ DPH is verified by VIES's last answer, a manual one VIES lapsed is upravené ručne, and one never asked is neoverené", () => {
  const verified = viewsOf({ icDph: "SK2020311337", sources: { icDph: "vies" }, viesStatus: { SK2020311337: { valid: true, lapsedAt: null } } });
  assert.equal(verified.icDph!.state, "overene");

  const lapsed = viewsOf({
    icDph: "SK2020311337",
    manualFields: ["icDph"],
    sources: { icDph: "manual" },
    viesStatus: { SK2020311337: { valid: false, lapsedAt: NOW } },
  });
  assert.equal(lapsed.icDph!.state, "upravene-rucne");
  assert.equal(lapsed.icDph!.registerValue, null, "VIES holds no number to return to");

  const unasked = viewsOf({ icDph: "SK2020311337", manualFields: ["icDph"], sources: { icDph: "manual" } });
  assert.equal(unasked.icDph!.state, "neoverene");
});

test("the rows the screens show carry the Slovak label, the state's label and the restore offer", () => {
  const rows = identityRowsOf(
    subject({
      address: "Hlavná 2, Košice",
      manualFields: ["address"],
      sources: { legalName: "register", address: "manual", dic: "register" },
      findings: [{ field: "address", kind: "register-disagrees", value: "Bratislava, Pribinova 25" }],
    }),
  );
  const address = rows.find((row) => row.field === "address")!;
  assert.equal(address.label, "Adresa");
  assert.equal(address.stateLabel, "upravené ručne");
  assert.equal(address.tone, "warn");
  assert.equal(address.registerValue, "Bratislava, Pribinova 25");
  assert.equal(address.restorable, true);
  assert.equal(rows.find((row) => row.field === "legalName")!.restorable, false);
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Právny názov", "Adresa", "IČO", "DIČ", "IČ DPH"],
  );
});

test("the three states have the Slovak labels the screens print", () => {
  assert.equal(identityStateLabel("overene"), "overené");
  assert.equal(identityStateLabel("upravene-rucne"), "upravené ručne");
  assert.equal(identityStateLabel("neoverene"), "neoverené");
});

test("the list's summary counts the fields in each state", () => {
  // Name, DIČ and IČO verified; the address a hand edit; the IČ DPH never checked.
  const views = identityFieldViews(
    subject({
      address: "Košice",
      manualFields: ["address"],
      sources: { legalName: "register", address: "manual", dic: "register" },
      findings: [{ field: "address", kind: "register-disagrees", value: "Bratislava, Pribinova 25" }],
    }),
  );
  assert.deepEqual(identitySummary(views), { overene: 3, upraveneRucne: 1, neoverene: 1 });
});

// The directory's side: a register answer applied to the subject, then read back as states.
function directoryOf(values: Partial<SubjectState> = {}): SubjectState {
  return {
    country: "SK",
    ico: "31333532",
    vatId: null,
    legalName: "Alfa s.r.o.",
    formerNames: [],
    dic: "2020311335",
    icDph: null,
    address: "Bratislava, Pribinova 25",
    registerStatus: "active",
    sources: {},
    manualFields: [],
    findings: [],
    verifiedAt: null,
    ...values,
  };
}

const FACTS = {
  legalName: "Alfa s.r.o.",
  formerNames: [],
  dic: "2020311335",
  address: "Bratislava, Pribinova 25",
  status: "active" as const,
};

/** The subject after an update, as the screens read it. */
function afterUpdate(base: SubjectState, changes: Partial<SubjectState>): IdentitySubject {
  return { ...base, ...changes, viesStatus: {} } as IdentitySubject;
}

test("a manual value the register says the same as is confirmed: its source is the register and it is no longer manual", () => {
  const base = directoryOf({ legalName: "Alfa s.r.o.", manualFields: ["legalName"], sources: { legalName: "manual" } });
  const update = applyRegisterFacts(base, FACTS, NOW);

  assert.equal(update.sources?.legalName, "register");
  assert.deepEqual(update.manualFields, []);
  assert.deepEqual(update.findings, []);
  assert.equal(afterUpdate(base, update).legalName, "Alfa s.r.o.");
});

test("a manual value the register says otherwise is kept, and the register's value is a finding", () => {
  const base = directoryOf({ legalName: "Alfa Holding s.r.o.", manualFields: ["legalName"], sources: { legalName: "manual" } });
  const update = applyRegisterFacts(base, FACTS, NOW);

  assert.equal(update.legalName, undefined, "the accountant's value is not overwritten");
  assert.deepEqual(update.manualFields, ["legalName"]);
  assert.deepEqual(update.findings, [{ field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: NOW }]);
  assert.equal(update.sources?.legalName, "manual");
});

test("a sheet value the register confirms becomes the register's; one it does not is kept with the register's value as a finding", () => {
  const confirmed = directoryOf({ legalName: "Alfa s.r.o.", sources: { legalName: SHEET } });
  const confirmedUpdate = applyRegisterFacts(confirmed, FACTS, NOW);
  assert.equal(confirmedUpdate.sources?.legalName, "register");
  assert.deepEqual(confirmedUpdate.findings, []);

  const differing = directoryOf({ legalName: "Alfa Holding s.r.o.", sources: { legalName: SHEET } });
  const differingUpdate = applyRegisterFacts(differing, FACTS, NOW);
  assert.equal(differingUpdate.legalName, undefined);
  assert.equal(differingUpdate.sources?.legalName, SHEET);
  assert.deepEqual(differingUpdate.findings, [{ field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: NOW }]);
  const views = identityFieldViews(afterUpdate(differing, differingUpdate));
  assert.equal(views.find((view) => view.field === "legalName")!.state, "neoverene");
});

test("a register-sourced value the register changed is overwritten, as before", () => {
  const base = directoryOf({ legalName: "Old s.r.o.", sources: { legalName: "register" } });
  const update = applyRegisterFacts(base, FACTS, NOW);
  assert.equal(update.legalName, "Alfa s.r.o.");
  assert.equal(update.sources?.legalName, "register");
});

test("a register answer that differs only in case is the same name: no finding for it", () => {
  const base = directoryOf({ legalName: "ALFA S.R.O.", manualFields: ["legalName"], sources: { legalName: "manual" } });
  const update = applyRegisterFacts(base, FACTS, NOW);
  assert.deepEqual(update.findings, []);
  assert.deepEqual(update.manualFields, []);
});

test("returning to the register's value sets the register's value, its source, and removes the manual mark and the finding", () => {
  const base = directoryOf({
    legalName: "Alfa Holding s.r.o.",
    manualFields: ["legalName", "dic"],
    sources: { legalName: "manual", dic: "manual" },
    findings: [
      { field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: NOW },
      { field: "dic", kind: "register-disagrees", value: "2020311399", at: NOW },
    ],
  });
  const restored = restoreRegisterValueOf(base, "legalName");
  assert.deepEqual(restored, {
    value: "Alfa s.r.o.",
    sources: { legalName: "register", dic: "manual" },
    manualFields: ["dic"],
    findings: [{ field: "dic", kind: "register-disagrees", value: "2020311399", at: NOW }],
  });

  // Applied, the name reads as the register's: overené, and the DIČ is still her own, disagreeing.
  const views = Object.fromEntries(
    identityFieldViews(
      afterUpdate(base, {
        legalName: restored!.value,
        sources: restored!.sources,
        manualFields: restored!.manualFields,
        findings: restored!.findings,
      }),
    ).map((view) => [view.field, view]),
  );
  assert.equal(views.legalName!.state, "overene");
  assert.equal(views.dic!.state, "upravene-rucne");
  assert.equal(views.dic!.registerValue, "2020311399");
});

test("there is nothing to return to where the register disagrees with nothing", () => {
  assert.equal(restoreRegisterValueOf(directoryOf({ manualFields: ["legalName"], sources: { legalName: "manual" } }), "legalName"), null);
});

test("VIES confirming her own IČ DPH makes it confirmed, and no longer hers alone", () => {
  const typed = directoryOf({ icDph: "SK2020311337", manualFields: ["icDph"], sources: { icDph: "manual" } });
  const update = icDphConfirmedByVies(typed, "SK2020311337", { valid: true, holderName: "Alfa s.r.o." });
  assert.deepEqual(update, {
    icDph: "SK2020311337",
    sources: { ...typed.sources, icDph: "vies" },
    manualFields: [],
  });
});
