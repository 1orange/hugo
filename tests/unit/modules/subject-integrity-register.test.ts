import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSubject,
  partyIdentityKey,
  parsePartyIntegrityRecord,
  subjectFindingMessage,
  type RegisterAnswer,
} from "../../../src/modules/subject-integrity.ts";

// A valid IČO (mod-11), as the register holds it.
const ICO = "35757442";

const REGISTER: RegisterAnswer = {
  legalName: "SLOVNAFT, a.s.",
  formerNames: ["Slovnaft Petrochémia, a.s."],
  dic: "2020372640",
  status: "active",
};

function counterparty(values: Partial<{ name: string; ico: string; dic: string; icDph: string }>) {
  return {
    party: { name: "", ico: ICO, dic: "", icDph: "", ...values },
    isClientParty: false,
  };
}

test("the same name in another legal form and punctuation matches the register", () => {
  for (const name of ["SLOVNAFT a.s.", "Slovnaft, a. s.", "slovnaft a s", "SLOVNAFT, a.s."]) {
    const check = checkSubject({ ...counterparty({ name }), register: REGISTER });
    assert.equal(check.verdict, "verified", name);
    assert.deepEqual(check.findings, [], name);
  }
});

test("a former name of the register is a notice, not a mismatch", () => {
  const check = checkSubject({ ...counterparty({ name: "Slovnaft Petrochémia, a. s." }), register: REGISTER });

  assert.equal(check.verdict, "notice");
  assert.deepEqual(check.findings.map((item) => [item.code, item.severity, item.expected]), [
    ["register-former-name", "notice", "SLOVNAFT, a.s."],
  ]);
  assert.match(subjectFindingMessage(check.findings[0]!), /Bývalý názov/);
});

test("another company's name is a mismatch that names the register's legal name", () => {
  const check = checkSubject({ ...counterparty({ name: "Gamma s.r.o." }), register: REGISTER });

  assert.equal(check.verdict, "mismatch");
  assert.equal(check.findings.length, 1);
  const [finding] = check.findings;
  assert.equal(finding!.code, "register-name");
  assert.equal(finding!.field, "name");
  assert.equal(finding!.expected, "SLOVNAFT, a.s.");
  assert.match(subjectFindingMessage(finding!), /v registri: SLOVNAFT, a.s./);
});

test("a DIČ that differs from the register's is a mismatch", () => {
  const check = checkSubject({
    ...counterparty({ name: "SLOVNAFT a.s.", dic: "2020311335" }),
    register: REGISTER,
  });

  assert.equal(check.verdict, "mismatch");
  assert.deepEqual(
    check.findings.map((item) => [item.code, item.field, item.expected]),
    [["register-dic", "dic", "2020372640"]],
  );
});

test("a DIČ is compared exactly after normalisation: spaces, case and the CZ prefix do not count", () => {
  const czRegister: RegisterAnswer = { legalName: "Alfa s.r.o.", formerNames: [], dic: "CZ12345678", status: "active" };
  const check = checkSubject({
    ...counterparty({ name: "Alfa s.r.o.", dic: "cz 12345678" }),
    register: czRegister,
  });

  assert.equal(check.verdict, "verified");
  assert.deepEqual(check.findings, []);
});

test("a dissolved company is a notice", () => {
  const check = checkSubject({
    ...counterparty({ name: "SLOVNAFT a.s." }),
    register: { ...REGISTER, status: "dissolved" },
  });

  assert.equal(check.verdict, "notice");
  assert.equal(check.findings[0]!.code, "register-dissolved");
});

test("an unavailable register leaves the offline checks in force", () => {
  const formal = checkSubject({ ...counterparty({ name: "SLOVNAFT a.s." }), register: { unavailable: true } });
  assert.equal(formal.verdict, "unavailable");

  const broken = checkSubject({
    ...counterparty({ name: "SLOVNAFT a.s.", ico: "35757443" }),
    register: { unavailable: true },
  });
  assert.equal(broken.verdict, "mismatch", "a bad IČO is still caught while the register is down");
});

test("an IČO the register does not hold is a notice", () => {
  const check = checkSubject({ ...counterparty({ name: "SLOVNAFT a.s." }), register: { notFound: true } });

  assert.equal(check.verdict, "notice");
  assert.equal(check.findings[0]!.code, "register-not-found");
  assert.match(subjectFindingMessage(check.findings[0]!), /registri/);
});

test("her own party is never judged by a register", () => {
  const profile = {
    country: "SK" as const,
    ico: ICO,
    icDph: "",
    dic: "2020372640",
    legalName: "Delta s.r.o.",
  };
  const check = checkSubject({
    party: { name: "Delta s.r.o.", ico: ICO, dic: "2020372640", icDph: "" },
    isClientParty: true,
    profile,
    register: REGISTER,
  });

  assert.equal(check.verdict, "verified");
  assert.deepEqual(check.findings, [], "the register's name is not compared with hers");
});

test("without a register answer the counterparty keeps its offline verdict", () => {
  assert.equal(checkSubject(counterparty({ name: "Anyone" })).verdict, "valid");
  assert.equal(checkSubject(counterparty({ name: "" })).verdict, "valid");
});

test("the identity key changes with any party value or with her profile, and is stable otherwise", () => {
  const fields = {
    supplierName: "Alfa s.r.o.",
    ico: ICO,
    dic: "",
    icDph: "",
    customerName: "Delta s.r.o.",
    customerIco: "31333532",
    customerDic: "",
    customerIcDph: "",
  };
  const profile = { country: "SK" as const, ico: "31333532", icDph: "SK2020311335", dic: "2020311335", legalName: "Delta s.r.o." };
  const key = partyIdentityKey(fields, profile);

  assert.equal(partyIdentityKey({ ...fields, supplierName: " Alfa s.r.o. " }, profile), key);
  assert.notEqual(partyIdentityKey({ ...fields, supplierName: "Alfa a.s." }, profile), key);
  assert.notEqual(partyIdentityKey(fields, { ...profile, legalName: "Delta a.s." }), key);
});

test("a stored verdict record is read only when it is whole", () => {
  const record = {
    identity: "x",
    checkedAt: "2026-01-01T00:00:00.000Z",
    supplier: { verdict: "verified", findings: [] },
    customer: { verdict: "valid", findings: [] },
  };
  assert.deepEqual(parsePartyIntegrityRecord(JSON.stringify(record)), record);
  assert.equal(parsePartyIntegrityRecord(null), null);
  assert.equal(parsePartyIntegrityRecord("{not json"), null);
  assert.equal(parsePartyIntegrityRecord(JSON.stringify({ ...record, supplier: { verdict: 1 } })), null);
});
