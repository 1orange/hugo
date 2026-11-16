import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSubject,
  offersRegisterTakeover,
  type IntegrityFinding,
  type SubjectCheck,
} from "../../../src/modules/subject-integrity.ts";
import {
  directoryKeyOf,
  icDphConfirmedByVies,
  type SubjectState,
} from "../../../src/modules/subject-directory.ts";

/** The rules behind *Prevziať z registra* and the directory's own IČ DPH (PRD 0004, story 34; ADR 0022). */

function check(findings: IntegrityFinding[]): SubjectCheck {
  return { verdict: findings.some((item) => item.severity === "mismatch") ? "mismatch" : "notice", findings };
}

const NAME_MISMATCH: IntegrityFinding = {
  field: "name",
  code: "register-name",
  severity: "mismatch",
  printed: "Alfa Holding s.r.o.",
  expected: "Alfa s.r.o.",
};
const DIC_MISMATCH: IntegrityFinding = {
  field: "dic",
  code: "register-dic",
  severity: "mismatch",
  printed: "2020999999",
  expected: "2020322832",
};
const VIES_HOLDER: IntegrityFinding = {
  field: "name",
  code: "vies-holder",
  severity: "mismatch",
  printed: "Alfa Holding s.r.o.",
  expected: "ALFA S.R.O.",
};

test("a register or VIES mismatch with the value it holds offers *Prevziať z registra*", () => {
  assert.equal(offersRegisterTakeover(check([NAME_MISMATCH])), true);
  assert.equal(offersRegisterTakeover(check([DIC_MISMATCH])), true);
  assert.equal(offersRegisterTakeover(check([VIES_HOLDER])), true);
});

test("a verdict without such a mismatch offers nothing", () => {
  // A notice is not a mismatch; a mismatch with no value to take is not the register's to fix.
  assert.equal(offersRegisterTakeover(check([{ ...NAME_MISMATCH, severity: "notice" }])), false);
  assert.equal(
    offersRegisterTakeover(check([{ field: "icDph", code: "vies-invalid", severity: "mismatch", printed: "SK1" }])),
    false,
  );
  assert.equal(offersRegisterTakeover(check([])), false);
  // The client's own party is judged against the profile: its findings are not the register's.
  assert.equal(
    offersRegisterTakeover(check([{ ...NAME_MISMATCH, code: "profile-name" }])),
    false,
  );
});

test("a mismatch the register states makes the verdict one that can be taken from", () => {
  const verdict = checkSubject({
    party: { name: "Alfa Holding s.r.o.", ico: "31322832", dic: "2020322832", icDph: "" },
    isClientParty: false,
    register: { legalName: "Alfa s.r.o.", formerNames: [], dic: "2020322832", status: "active" },
  });

  assert.equal(verdict.verdict, "mismatch");
  assert.equal(offersRegisterTakeover(verdict), true);
});

const SUBJECT: SubjectState = {
  country: "SK",
  ico: "31322832",
  vatId: null,
  legalName: "Alfa s.r.o.",
  formerNames: [],
  dic: "2020322832",
  icDph: null,
  address: null,
  registerStatus: "active",
  sources: { legalName: "register", dic: "register" },
  manualFields: [],
  findings: [],
  verifiedAt: "2026-03-01T00:00:00.000Z",
};
const VALID = { valid: true, holderName: "Alfa s.r.o." };

test("a VAT ID VIES holds under the subject's own name is the subject's IČ DPH", () => {
  const update = icDphConfirmedByVies(SUBJECT, "SK2020322832", VALID);

  assert.deepEqual(update, { icDph: "SK2020322832", sources: { ...SUBJECT.sources, icDph: "vies" } });
});

test("VIES's holder under another name, a group, an invalid or lapsed number records nothing", () => {
  assert.equal(icDphConfirmedByVies(SUBJECT, "SK2020322832", { valid: true, holderName: "Beta s.r.o." }), null);
  assert.equal(
    icDphConfirmedByVies(SUBJECT, "SK2020322832", { valid: true, holderName: "Group registration" }),
    null,
  );
  assert.equal(icDphConfirmedByVies(SUBJECT, "SK2020322832", { valid: false, holderName: null }), null);
  assert.equal(icDphConfirmedByVies(SUBJECT, "SK2020322832", { valid: true, holderName: "Alfa s.r.o.", lapsed: true }), null);
  assert.equal(icDphConfirmedByVies(SUBJECT, "SK2020322832", { unavailable: true }), null);
});

test("a subject's IČ DPH she corrected herself is not overwritten by VIES", () => {
  const corrected: SubjectState = { ...SUBJECT, icDph: "SK2020322899", manualFields: ["icDph"] };

  assert.equal(icDphConfirmedByVies(corrected, "SK2020322832", VALID), null);
});

test("a party with an IČO is keyed by its country and IČO; one with only an IČO by the IČO alone", () => {
  assert.equal(directoryKeyOf({ name: "Alfa", ico: "31322832", dic: "2020322832", icDph: "" }), "SK:31322832");
  assert.equal(directoryKeyOf({ name: "Alfa", ico: "31322832", dic: "", icDph: "" }), "ico:31322832");
  assert.equal(directoryKeyOf({ name: "Alfa", ico: "", dic: "", icDph: "" }), null);
  assert.equal(directoryKeyOf({ name: "Gamma", ico: "", dic: "", icDph: "DE123456789" }), "vat:DE123456789");
});
