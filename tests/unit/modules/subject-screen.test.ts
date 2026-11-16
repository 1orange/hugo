import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correctableFieldLabel,
  directoryFindingMessage,
  sourceLabel,
  subjectVerdictOf,
  validateSubjectCorrection,
  viesStatusLabel,
} from "../../../src/modules/subject-screen.ts";
import { verdictLabel } from "../../../src/modules/subject-integrity.ts";

const CLEAN = {
  country: "SK" as const,
  legalName: "Slovnaft, a. s.",
  registerStatus: "active" as const,
  verifiedAt: "2026-03-01T00:00:00.000Z",
  findings: [],
  viesStatus: {},
};

test("a subject the register confirmed is verified", () => {
  assert.equal(subjectVerdictOf(CLEAN), "verified");
  assert.equal(verdictLabel(subjectVerdictOf(CLEAN)), "Overené");
});

test("a finding on the subject is a mismatch, whoever made it", () => {
  const disagreed = {
    ...CLEAN,
    findings: [{ field: "legalName" as const, kind: "register-disagrees" as const, value: "Alfa s.r.o.", at: "x" }],
  };
  assert.equal(subjectVerdictOf(disagreed), "mismatch");
  assert.equal(
    subjectVerdictOf({ ...CLEAN, findings: [{ field: "dic" as const, kind: "register-disagrees" as const, value: "x", at: "x" }] }),
    "mismatch",
  );
});

test("a dissolved subject is a mismatch, and a lapsed VIES number too", () => {
  assert.equal(subjectVerdictOf({ ...CLEAN, registerStatus: "dissolved" }), "mismatch");
  assert.equal(
    subjectVerdictOf({
      ...CLEAN,
      viesStatus: { SK2020322832: { valid: false, holderName: null, checkedAt: "x", lapsedAt: "y" } },
    }),
    "mismatch",
  );
});

test("a subject never looked up, and a foreign one without a register, cannot be verified", () => {
  assert.equal(subjectVerdictOf({ ...CLEAN, legalName: null, verifiedAt: null }), "unverifiable");
  assert.equal(subjectVerdictOf({ ...CLEAN, country: "foreign", legalName: "Acme GmbH", verifiedAt: null }), "unverifiable");
});

test("a subject the register does not list is a notice", () => {
  assert.equal(subjectVerdictOf({ ...CLEAN, legalName: null }), "notice");
});

test("every value source has its Slovak label, and a value with no source says so", () => {
  assert.equal(sourceLabel("register"), "z registra");
  assert.equal(sourceLabel("vies"), "z VIES");
  assert.equal(sourceLabel("manual"), "ručne");
  assert.equal(sourceLabel(undefined), "—");
});

test("the correctable fields are named in Slovak", () => {
  assert.equal(correctableFieldLabel("legalName"), "Názov");
  assert.equal(correctableFieldLabel("address"), "Adresa");
  assert.equal(correctableFieldLabel("dic"), "DIČ");
  assert.equal(correctableFieldLabel("icDph"), "IČ DPH");
  assert.equal(correctableFieldLabel("vatGroupId"), "IČ DPH skupiny");
});

test("a register disagreement reads as a Slovak sentence naming the register's value", () => {
  assert.equal(
    directoryFindingMessage({ field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: "x" }),
    "Názov: register dnes uvádza „Alfa s.r.o.“, ručná oprava sa líši.",
  );
});

test("VIES status reads as Slovak", () => {
  assert.equal(viesStatusLabel({ valid: true, holderName: "X", checkedAt: "x", lapsedAt: null }), "platné");
  assert.equal(viesStatusLabel({ valid: false, holderName: null, checkedAt: "x", lapsedAt: null }), "neregistrované");
  assert.equal(viesStatusLabel({ valid: false, holderName: null, checkedAt: "x", lapsedAt: "y" }), "už neplatné");
});

test("a name must not be emptied; an address may be cleared", () => {
  assert.deepEqual(validateSubjectCorrection("legalName", "  Alfa Holding s.r.o. "), { ok: true, value: "Alfa Holding s.r.o." });
  assert.deepEqual(validateSubjectCorrection("legalName", "   "), { ok: false, message: "Názov nesmie byť prázdny." });
  assert.deepEqual(validateSubjectCorrection("address", " "), { ok: true, value: null });
});

test("a DIČ is cleared by an empty value, or takes ten digits, or CZ and eight to ten", () => {
  assert.deepEqual(validateSubjectCorrection("dic", ""), { ok: true, value: null });
  assert.deepEqual(validateSubjectCorrection("dic", "2020 322 832"), { ok: true, value: "2020322832" });
  assert.deepEqual(validateSubjectCorrection("dic", "CZ 31333532"), { ok: true, value: "CZ31333532" });
  assert.equal(validateSubjectCorrection("dic", "202032").ok, false);
});

test("an IČ DPH is SK and ten digits divisible by eleven, or CZ and eight to ten digits", () => {
  assert.deepEqual(validateSubjectCorrection("icDph", "sk 7120001713"), { ok: true, value: "SK7120001713" });
  assert.deepEqual(validateSubjectCorrection("icDph", "CZ31333532"), { ok: true, value: "CZ31333532" });
  assert.deepEqual(validateSubjectCorrection("icDph", "SK2020322899"), {
    ok: false,
    message: "Slovenské IČ DPH musí byť deliteľné 11.",
  });
  assert.equal(validateSubjectCorrection("icDph", "SK123").ok, false);
});

test("a VAT group is a VAT ID or nothing", () => {
  assert.deepEqual(validateSubjectCorrection("vatGroupId", "SK 7120001713"), { ok: true, value: "SK7120001713" });
  assert.deepEqual(validateSubjectCorrection("vatGroupId", ""), { ok: true, value: null });
  assert.equal(validateSubjectCorrection("vatGroupId", "7120").ok, false);
});
