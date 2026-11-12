import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSubject,
  subjectFindingMessage,
  type SubjectCheck,
  type RegisterAnswer,
} from "../../../src/modules/subject-integrity.ts";
import {
  correctSubjectField,
  correctVatGroup,
  groupVatIdOf,
  nextViesRecord,
  recordVatGroupFromVies,
  viesAnswerOf,
  viesTargetOf,
  type SubjectState,
  type ViesRecord,
} from "../../../src/modules/subject-directory.ts";
import type { ClientIdentity, PartyIdentity } from "../../../src/modules/party-roles.ts";

// VIES as measured on 2026-09-29 (ADR 0018 amendment): public numbers, cited there.
const SPRING = "SPRING.etc., spol. s r. o.";
const GROUP_HOLDER = "Group registration - This VAT ID corresponds to a Group of Taxpayers";
const SLOVNAFT_REGISTER: RegisterAnswer = {
  legalName: "Slovnaft, a. s.",
  formerNames: [],
  dic: "2020372640",
  status: "active",
};

function party(values: Partial<PartyIdentity>): PartyIdentity {
  return { name: "", ico: "", dic: "", icDph: "", ...values };
}

function codes(check: SubjectCheck): string[] {
  return check.findings.map((item) => item.code);
}

const PROFILE: ClientIdentity = {
  country: "SK",
  legalName: "Delta, a. s.",
  ico: "31333532",
  dic: "2020311337",
  icDph: "SK2020311337",
};

// --- A VAT ID VIES says is not registered --------------------------------------

test("an IČ DPH VIES does not know is a mismatch, whatever the holder", () => {
  const check = checkSubject({
    party: party({ name: "Slovnaft, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" }),
    isClientParty: false,
    register: SLOVNAFT_REGISTER,
    vies: { valid: false, holderName: null },
  });
  assert.equal(check.verdict, "mismatch");
  assert.deepEqual(codes(check), ["vies-invalid"]);
  assert.equal(subjectFindingMessage(check.findings[0]!), "IČ DPH nie je registrované vo VIES — overte číslo.");
});

test("an IČ DPH that VIES no longer knows, after it knew it, says so: the registration lapsed", () => {
  const check = checkSubject({
    party: party({ name: "Slovnaft, a. s.", icDph: "SK2023141351" }),
    isClientParty: false,
    vies: { valid: false, holderName: null, lapsed: true },
  });
  assert.equal(check.verdict, "mismatch");
  assert.deepEqual(codes(check), ["vies-lapsed"]);
  assert.equal(subjectFindingMessage(check.findings[0]!), "IČ DPH už nie je platné — VIES ho dnes nepozná.");
});

// --- A registered IČ DPH: its holder --------------------------------------------

test("a registered IČ DPH held by the same company is verified", () => {
  const check = checkSubject({
    party: party({ name: SPRING, icDph: "SK2023141351", dic: "2023141351" }),
    isClientParty: false,
    vies: { valid: true, holderName: SPRING },
  });
  assert.equal(check.verdict, "verified");
  assert.deepEqual(check.findings, []);
});

test("the legal form and punctuation of the holder's name do not matter", () => {
  const check = checkSubject({
    party: party({ name: "SPRING.etc. spol. s r.o.", icDph: "SK2023141351" }),
    isClientParty: false,
    vies: { valid: true, holderName: SPRING },
  });
  assert.equal(check.verdict, "verified");
});

test("a registered IČ DPH held by another company is a mismatch showing the VIES holder", () => {
  const check = checkSubject({
    party: party({ name: "Alfa s.r.o.", icDph: "SK2023141351" }),
    isClientParty: false,
    vies: { valid: true, holderName: SPRING },
  });
  assert.equal(check.verdict, "mismatch");
  assert.deepEqual(
    check.findings.map((item) => [item.field, item.code, item.expected]),
    [["name", "vies-holder", SPRING]],
  );
  assert.equal(subjectFindingMessage(check.findings[0]!), `Názov nezodpovedá IČ DPH — vo VIES je: ${SPRING}.`);
});

test("the holder may be the register's name for the IČO, where the printed name is a trade name", () => {
  const check = checkSubject({
    party: party({ name: "Trade name", icDph: "SK2023141351" }),
    isClientParty: false,
    register: { legalName: SPRING, formerNames: [], dic: null, status: "active" },
    vies: { valid: true, holderName: SPRING },
  });
  assert.ok(!codes(check).includes("vies-holder"), "the holder is the register's name, which the IČO vouches for");
});

// --- VAT groups ---------------------------------------------------------------------

test("a VAT group's IČ DPH with no membership recorded is a notice, not a verified party", () => {
  const check = checkSubject({
    party: party({ name: "Slovnaft, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK7120001713" }),
    isClientParty: false,
    register: SLOVNAFT_REGISTER,
    vies: { valid: true, holderName: GROUP_HOLDER },
  });
  assert.equal(check.verdict, "notice");
  assert.deepEqual(codes(check), ["vat-group-unconfirmed"]);
  assert.equal(subjectFindingMessage(check.findings[0]!), "Skupinová registrácia DPH — členstvo nie je potvrdené.");
});

test("the same VAT group IČ DPH is verified once the subject is recorded as a member of that group", () => {
  const check = checkSubject({
    party: party({ name: "Slovnaft, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK7120001713" }),
    isClientParty: false,
    register: SLOVNAFT_REGISTER,
    vies: { valid: true, holderName: GROUP_HOLDER },
    vatGroupId: "SK7120001713",
  });
  assert.equal(check.verdict, "verified");
  assert.deepEqual(check.findings, []);
});

test("membership of another group does not verify this group's IČ DPH", () => {
  const check = checkSubject({
    party: party({ name: "Slovnaft, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK7120001713" }),
    isClientParty: false,
    register: SLOVNAFT_REGISTER,
    vies: { valid: true, holderName: GROUP_HOLDER },
    vatGroupId: "SK7120001714",
  });
  assert.equal(check.verdict, "notice");
  assert.deepEqual(codes(check), ["vat-group-unconfirmed"]);
});

test("the group holder is recognised whatever its case", () => {
  const check = checkSubject({
    party: party({ name: "Slovnaft, a. s.", icDph: "SK7120001713" }),
    isClientParty: false,
    vies: { valid: true, holderName: "GROUP REGISTRATION" },
  });
  assert.deepEqual(codes(check), ["vat-group-unconfirmed"]);
});

test("a VAT group explained by VIES is no longer a question of SK + DIČ", () => {
  // Without VIES the offline check still asks: the IČ DPH is not SK + DIČ.
  const offline = checkSubject({
    party: party({ name: "Slovnaft, a. s.", icDph: "SK7120001713", dic: "2020372640" }),
    isClientParty: false,
  });
  assert.deepEqual(codes(offline), ["vat-group"]);
  assert.equal(offline.verdict, "notice");

  // With VIES's group registration, the notice is the more specific one: one notice, not two.
  const withVies = checkSubject({
    party: party({ name: "Slovnaft, a. s.", icDph: "SK7120001713", dic: "2020372640" }),
    isClientParty: false,
    vies: { valid: true, holderName: GROUP_HOLDER },
  });
  assert.deepEqual(codes(withVies), ["vat-group-unconfirmed"]);
});

// --- Holders VIES does not name ----------------------------------------------------

test("an empty holder name is no name to compare, not a mismatch", () => {
  const check = checkSubject({
    party: party({ name: "Alfa s.r.o.", icDph: "SK2023141351" }),
    isClientParty: false,
    vies: { valid: true, holderName: "" },
  });
  assert.notEqual(check.verdict, "mismatch");
  assert.deepEqual(check.findings, []);
  assert.equal(check.verdict, "valid", "registered as VIES says, and formally correct");
});

test("a holder of --- is no name to compare, not a mismatch", () => {
  const check = checkSubject({
    party: party({ name: "Alfa s.r.o.", icDph: "SK2023141351" }),
    isClientParty: false,
    vies: { valid: true, holderName: "---" },
  });
  assert.notEqual(check.verdict, "mismatch");
  assert.deepEqual(check.findings, []);
});

test("an absent holder name still leaves the register's comparison in force", () => {
  const check = checkSubject({
    party: party({ name: "Slovnaft, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" }),
    isClientParty: false,
    register: SLOVNAFT_REGISTER,
    vies: { valid: true, holderName: null },
  });
  assert.equal(check.verdict, "verified", "the register confirms the name and the DIČ");
});

// --- VIES unavailable: that check only -----------------------------------------------

test("a VIES outage on a verified register subject leaves that verdict and names the check", () => {
  const check = checkSubject({
    party: party({ name: "Slovnaft, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" }),
    isClientParty: false,
    register: SLOVNAFT_REGISTER,
    vies: { unavailable: true },
  });
  assert.equal(check.verdict, "verified");
  assert.deepEqual(
    check.findings.map((item) => [item.field, item.code, item.severity]),
    [["icDph", "vies-unavailable", "unavailable"]],
  );
});

test("a VIES outage with nothing else to compare is unavailable", () => {
  const check = checkSubject({
    party: party({ name: "Alfa s.r.o.", icDph: "SK2023141351" }),
    isClientParty: false,
    vies: { unavailable: true },
  });
  assert.equal(check.verdict, "unavailable");
});

test("a VIES outage does not hide a register mismatch", () => {
  const check = checkSubject({
    party: party({ name: "Alfa s.r.o.", ico: "31322832", icDph: "SK2023141351" }),
    isClientParty: false,
    register: SLOVNAFT_REGISTER,
    vies: { unavailable: true },
  });
  assert.equal(check.verdict, "mismatch");
  assert.ok(codes(check).includes("register-name"));
});

// --- Her own party is never sent to VIES ----------------------------------------------

test("her own party is judged by the profile alone, whatever VIES would say", () => {
  const check = checkSubject({
    party: party({ name: "Delta, a. s.", ico: "31333532", dic: "2020311337", icDph: "SK2020311337" }),
    isClientParty: true,
    profile: PROFILE,
    vies: { valid: false, holderName: null },
  });
  assert.equal(check.verdict, "verified");
  assert.deepEqual(check.findings, []);
});

// --- The VIES target and the record kept per VAT ID ------------------------------------

test("the VAT ID asked of VIES is the IČ DPH, a Czech DIČ, or a foreign VAT ID; malformed or non-EU ones are not asked", () => {
  const sk = (values: Partial<PartyIdentity>) => viesTargetOf(party(values), "SK");
  assert.equal(sk({ icDph: "SK2023141351" }), "SK2023141351");
  assert.equal(sk({ icDph: "sk 2023 141 351" }), "SK2023141351");
  assert.equal(sk({ icDph: "SK2023141352" }), null, "not divisible by 11: already a mismatch offline");
  assert.equal(sk({ dic: "2023141351" }), null, "a Slovak DIČ alone is not a VAT ID VIES is asked about");
  assert.equal(viesTargetOf(party({ dic: "CZ31333532" }), "CZ"), "CZ31333532");
  assert.equal(viesTargetOf(party({ icDph: "DE123456789" }), "foreign"), "DE123456789");
  assert.equal(viesTargetOf(party({ icDph: "CHE123456789" }), "foreign"), null, "outside the EU: not VIES's to say");
});

test("VIES's answer is kept per VAT ID: a valid answer that turns invalid is a lapse, from the first invalid answer on", () => {
  const first: ViesRecord = nextViesRecord(undefined, { valid: true, name: SPRING }, "2026-03-01T00:00:00.000Z");
  assert.deepEqual(first, { valid: true, holderName: SPRING, checkedAt: "2026-03-01T00:00:00.000Z", lapsedAt: null });

  const lapsed = nextViesRecord(first, { valid: false, name: null }, "2026-04-01T00:00:00.000Z");
  assert.equal(lapsed.lapsedAt, "2026-04-01T00:00:00.000Z");
  assert.deepEqual(viesAnswerOf(lapsed), { valid: false, holderName: null, lapsed: true });

  const stillLapsed = nextViesRecord(lapsed, { valid: false, name: null }, "2026-05-01T00:00:00.000Z");
  assert.equal(stillLapsed.lapsedAt, "2026-04-01T00:00:00.000Z", "the lapse keeps the day it happened");

  const back = nextViesRecord(stillLapsed, { valid: true, name: SPRING }, "2026-06-01T00:00:00.000Z");
  assert.equal(back.lapsedAt, null);
});

test("a number that was never valid is invalid, not lapsed", () => {
  const record = nextViesRecord(undefined, { valid: false, name: null }, "2026-03-01T00:00:00.000Z");
  assert.equal(record.lapsedAt, null);
  assert.deepEqual(viesAnswerOf(record), { valid: false, holderName: null });
});

// --- VAT group membership, and its provenance ---------------------------------------------

function subject(values: Partial<SubjectState> = {}): SubjectState {
  return {
    country: "SK",
    ico: "31322832",
    vatId: null,
    legalName: "Slovnaft, a. s.",
    formerNames: [],
    dic: "2020372640",
    icDph: null,
    address: null,
    registerStatus: "active",
    sources: {},
    manualFields: [],
    findings: [],
    verifiedAt: "2026-03-01T00:00:00.000Z",
    ...values,
  };
}

test("a VAT group ID is stored normalised, and a value that is not a VAT ID is refused", () => {
  assert.equal(groupVatIdOf(" sk 7120001713 "), "SK7120001713");
  assert.equal(groupVatIdOf(""), null);
  assert.throws(() => groupVatIdOf("7120001713"), /IČ DPH skupiny/);
  assert.throws(() => groupVatIdOf("SK-71/2"), /IČ DPH skupiny/);
});

test("her correction of the group is manual, and a membership a document shows is not", () => {
  const manual = correctVatGroup(subject(), "SK7120001713");
  assert.equal(manual.vatGroupId, "SK7120001713");
  assert.equal(manual.sources?.vatGroupId, "manual");
  assert.deepEqual(manual.manualFields, ["vatGroupId"]);

  const removed = correctVatGroup(subject({ manualFields: ["vatGroupId"] }), null);
  assert.equal(removed.vatGroupId, null);
  assert.deepEqual(removed.manualFields, ["vatGroupId"], "not repeated");

  const fromVies = recordVatGroupFromVies(subject(), "SK7120001713");
  assert.equal(fromVies.vatGroupId, "SK7120001713");
  assert.equal(fromVies.sources?.vatGroupId, "vies");
  assert.equal(fromVies.manualFields, undefined);
});

test("the field correction refuses the group, which has its own rule (correctVatGroup)", () => {
  assert.throws(() => correctSubjectField(subject(), "vatGroupId", "SK7120001713", "2026-03-01T00:00:00.000Z"), /correctVatGroup/);
});
