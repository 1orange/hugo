import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRegisterFacts,
  correctSubjectField,
  isStale,
  pickAliasSubject,
  registerAnswerOf,
  subjectCountryOf,
  subjectKeyOf,
  vatIdOf,
  type SubjectState,
} from "../../../src/modules/subject-directory.ts";

const NOW = "2026-03-01T00:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

function daysBefore(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY).toISOString();
}

function subject(values: Partial<SubjectState> = {}): SubjectState {
  return {
    country: "SK",
    ico: "31333532",
    vatId: null,
    legalName: "Alfa s.r.o.",
    formerNames: [],
    dic: "2020311335",
    icDph: null,
    address: "Bratislava",
    registerStatus: "active",
    sources: { legalName: "register", dic: "register" },
    manualFields: [],
    findings: [],
    verifiedAt: daysBefore(1),
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

test("a subject is keyed by country and IČO, or by its VAT ID when it has no IČO", () => {
  assert.deepEqual(subjectKeyOf({ name: "Alfa", ico: "31333532", dic: "2020311335", icDph: "" }, "SK"), {
    country: "SK",
    ico: "31333532",
    vatId: null,
  });
  assert.deepEqual(subjectKeyOf({ name: "Alfa", ico: "31333532", dic: "CZ31333532", icDph: "" }, "CZ"), {
    country: "CZ",
    ico: "31333532",
    vatId: "CZ31333532",
  });
  assert.deepEqual(subjectKeyOf({ name: "Acme", ico: "", dic: "", icDph: "DE123456789" }, "foreign"), {
    country: "foreign",
    ico: null,
    vatId: "DE123456789",
  });
  assert.equal(subjectKeyOf({ name: "Nobody", ico: "", dic: "", icDph: "" }, null), null);
});

test("a Slovak DIČ without a prefix says Slovak; a CZ DIČ says Czech", () => {
  assert.equal(subjectCountryOf({ name: "", ico: "31333532", dic: "2020311335", icDph: "" }), "SK");
  assert.equal(subjectCountryOf({ name: "", ico: "31333532", dic: "CZ31333532", icDph: "" }), "CZ");
  assert.equal(subjectCountryOf({ name: "", ico: "31333532", dic: "", icDph: "" }), null);
  assert.equal(vatIdOf({ name: "", ico: "", dic: "", icDph: "sk 2020311335" }, "SK"), "SK2020311335");
});

test("register data is stale once it is as old as the refresh age, and never fetched is stale", () => {
  assert.equal(isStale(null, NOW, 30), true);
  assert.equal(isStale(daysBefore(29), NOW, 30), false);
  assert.equal(isStale(daysBefore(30), NOW, 30), true);
});

test("a fresh register answer fills the fields it owns and records their source", () => {
  const update = applyRegisterFacts(subject({ legalName: "Old s.r.o.", sources: {} }), FACTS, NOW);

  assert.equal(update.legalName, "Alfa s.r.o.");
  assert.equal(update.address, "Bratislava, Pribinova 25");
  assert.equal(update.registerStatus, "active");
  assert.equal(update.verifiedAt, NOW);
  assert.equal(update.sources?.legalName, "register");
  assert.deepEqual(update.findings, []);
});

test("a refresh never overwrites a manual value; a disagreeing register answer becomes a finding", () => {
  const corrected = subject({ legalName: "Alfa Holding s.r.o.", manualFields: ["legalName"], sources: { legalName: "manual" } });

  const update = applyRegisterFacts(corrected, FACTS, NOW);

  assert.equal(update.legalName, undefined, "the accountant's value is kept");
  assert.deepEqual(update.findings, [
    { field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: NOW },
  ]);
  assert.equal(update.sources?.legalName, "manual");
});

test("a register answer that agrees with a manual value clears the earlier finding", () => {
  const disagreeing = subject({
    manualFields: ["legalName"],
    findings: [{ field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: daysBefore(40) }],
  });

  const update = applyRegisterFacts(disagreeing, FACTS, NOW);

  assert.deepEqual(update.findings, []);
});

test("her correction is manual, kept over refreshes, and resolves the disagreement about that field", () => {
  const flagged = subject({
    findings: [{ field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: daysBefore(2) }],
  });

  const update = correctSubjectField(flagged, "legalName", "  Alfa Holding s.r.o. ", NOW);

  assert.equal(update.legalName, "Alfa Holding s.r.o.");
  assert.deepEqual(update.manualFields, ["legalName"]);
  assert.equal(update.sources?.legalName, "manual");
  assert.deepEqual(update.findings, []);
});

test("only the fields an accountant may correct can be corrected", () => {
  assert.throws(() => correctSubjectField(subject(), "formerNames", "x", NOW), /nedá upraviť/);
});

test("a name points to a subject by its most often seen subject; a tie points to none", () => {
  assert.equal(pickAliasSubject([{ subject: "a", count: 3 }, { subject: "b", count: 1 }]), "a");
  assert.equal(pickAliasSubject([{ subject: "a", count: 2 }, { subject: "b", count: 2 }]), null);
  assert.equal(pickAliasSubject([]), null);
});

test("a subject with register data answers the integrity check with it; one without answers nothing", () => {
  assert.deepEqual(registerAnswerOf(subject()), {
    legalName: "Alfa s.r.o.",
    formerNames: [],
    dic: "2020311335",
    status: "active",
  });
  assert.equal(registerAnswerOf(subject({ legalName: null })), null);
  assert.equal(registerAnswerOf(subject({ registerStatus: "dissolved" }))?.status, "dissolved");
});

