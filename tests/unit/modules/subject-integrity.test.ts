import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkBothParties,
  checkDocumentParties,
  checkSubject,
  clientSideOf,
  subjectFindingMessage,
  verdictLabel,
  type SubjectCheck,
} from "../../../src/modules/subject-integrity.ts";
import type { ClientIdentity, PartyIdentity } from "../../../src/modules/party-roles.ts";

const EMPTY: PartyIdentity = { name: "", ico: "", dic: "", icDph: "" };

// Delta, a. s. — hers. Its IČ DPH is SK + DIČ, both mod-11 valid.
const PROFILE: ClientIdentity = {
  country: "SK",
  legalName: "Delta, a. s.",
  ico: "31322832",
  dic: "2020372640",
  icDph: "SK2020372640",
};

function party(values: Partial<PartyIdentity>): PartyIdentity {
  return { ...EMPTY, ...values };
}

function offline(values: Partial<PartyIdentity>): SubjectCheck {
  return checkSubject({ party: party(values), isClientParty: false });
}

function summary(check: SubjectCheck): string[] {
  return check.findings.map((finding) => `${finding.field}:${finding.code}:${finding.severity}`);
}

type Row = { why: string; values: Partial<PartyIdentity>; verdict: SubjectCheck["verdict"]; findings?: string[] };

function runRows(rows: Row[]) {
  for (const row of rows) {
    test(row.why, () => {
      const check = offline(row.values);
      assert.equal(check.verdict, row.verdict);
      if (row.findings) {
        assert.deepEqual(summary(check), row.findings);
      }
    });
  }
}

// --- IČO (SK and CZ use the same checksum) ---------------------------------

runRows([
  { why: "a valid SK IČO passes", values: { ico: "31322832" }, verdict: "valid", findings: [] },
  { why: "a valid IČO with remainder 1 passes (Stanica Nivy)", values: { ico: "50861930" }, verdict: "valid", findings: [] },
  { why: "a valid CZ IČO passes", values: { ico: "25596641" }, verdict: "valid", findings: [] },
  { why: "a spaced IČO is checked without its spaces", values: { ico: "31 322 832" }, verdict: "valid", findings: [] },
  { why: "a wrong check digit is a mismatch", values: { ico: "31333531" }, verdict: "mismatch", findings: ["ico:ico-checksum:mismatch"] },
  { why: "a seven-digit IČO is a mismatch", values: { ico: "3132283" }, verdict: "mismatch", findings: ["ico:ico-format:mismatch"] },
  { why: "a nine-digit IČO is a mismatch", values: { ico: "313228321" }, verdict: "mismatch", findings: ["ico:ico-format:mismatch"] },
  { why: "an IČO with a letter is a mismatch", values: { ico: "3132283X" }, verdict: "mismatch", findings: ["ico:ico-format:mismatch"] },
  { why: "an absent IČO is not checked", values: { name: "Alfa s.r.o." }, verdict: "unverifiable", findings: [] },
]);

// --- DIČ --------------------------------------------------------------------

runRows([
  { why: "a ten-digit DIČ without a country passes", values: { ico: "31322832", dic: "2020372640" }, verdict: "valid", findings: [] },
  { why: "a nine-digit DIČ of a Slovak IČ DPH is a mismatch", values: { icDph: "SK2020372640", dic: "202037264" }, verdict: "mismatch", findings: ["dic:dic-format:mismatch"] },
  { why: "a nine-digit DIČ with no country is not guessed at", values: { ico: "31322832", dic: "202037264" }, verdict: "valid", findings: [] },
  { why: "a DIČ with an SK prefix is a mismatch", values: { dic: "SK2020372640" }, verdict: "mismatch", findings: ["dic:dic-format:mismatch"] },
  { why: "a Czech DIČ CZ + 8 digits passes", values: { dic: "CZ25596641" }, verdict: "valid", findings: [] },
  { why: "a Czech DIČ with seven digits is a mismatch", values: { dic: "CZ2559664" }, verdict: "mismatch", findings: ["dic:dic-format:mismatch"] },
  { why: "a Czech DIČ with thirteen digits is a mismatch", values: { dic: "CZ1234567890123" }, verdict: "mismatch", findings: ["dic:dic-format:mismatch"] },
  { why: "unprefixed eight digits pass beside a Czech IČ DPH", values: { icDph: "CZ25596641", dic: "25596641" }, verdict: "valid", findings: [] },
  { why: "unprefixed seven digits beside a Czech IČ DPH are a mismatch", values: { icDph: "CZ25596641", dic: "2559664" }, verdict: "mismatch", findings: ["dic:dic-format:mismatch"] },
  { why: "a foreign party's DIČ is not checked", values: { icDph: "DE123456789", dic: "XYZ123" }, verdict: "unverifiable", findings: [] },
]);

// --- IČ DPH -----------------------------------------------------------------

runRows([
  { why: "a Slovak IČ DPH divisible by 11 passes", values: { icDph: "SK2020372640" }, verdict: "valid", findings: [] },
  { why: "a Slovak IČ DPH is read without spaces or case", values: { icDph: "sk 2020 372640" }, verdict: "valid", findings: [] },
  { why: "a Slovak IČ DPH not divisible by 11 is a mismatch", values: { icDph: "SK2020311335" }, verdict: "mismatch", findings: ["icDph:icdph-mod11:mismatch"] },
  { why: "a Slovak IČ DPH with three digits is a mismatch", values: { icDph: "SK123" }, verdict: "mismatch", findings: ["icDph:icdph-format:mismatch"] },
  { why: "a Slovak IČ DPH with eleven digits is a mismatch", values: { icDph: "SK12345678901" }, verdict: "mismatch", findings: ["icDph:icdph-format:mismatch"] },
  { why: "a Czech IČ DPH CZ + 8 digits with a valid IČO checksum passes", values: { icDph: "CZ25596641" }, verdict: "valid", findings: [] },
  { why: "a Czech IČ DPH CZ + 9 digits passes its shape", values: { icDph: "CZ123456789" }, verdict: "valid", findings: [] },
  { why: "a Czech IČ DPH with seven digits is a mismatch", values: { icDph: "CZ2559664" }, verdict: "mismatch", findings: ["icDph:icdph-format:mismatch"] },
  { why: "a Czech IČ DPH CZ + 8 digits with a bad checksum is a mismatch", values: { icDph: "CZ12345678" }, verdict: "mismatch", findings: ["icDph:icdph-checksum:mismatch"] },
  { why: "an IČ DPH without a country prefix is a mismatch", values: { icDph: "2020372640" }, verdict: "mismatch", findings: ["icDph:icdph-format:mismatch"] },
  { why: "a foreign IČ DPH is not checked", values: { icDph: "DE123456789" }, verdict: "unverifiable", findings: [] },
  { why: "another foreign IČ DPH is not checked", values: { icDph: "IE1234567A" }, verdict: "unverifiable", findings: [] },
]);

// --- SK + DIČ ≠ IČ DPH: a notice (VAT groups), never a mismatch --------------

runRows([
  {
    why: "a VAT group's IČ DPH beside another DIČ is a notice",
    values: { icDph: "SK2023141351", dic: "2020372640" },
    verdict: "notice",
    findings: ["icDph:vat-group:notice"],
  },
  {
    why: "the group number of a Slovak receipt is a notice, not a mismatch",
    values: { icDph: "SK7120001713", dic: "2020372640" },
    verdict: "notice",
    findings: ["icDph:vat-group:notice"],
  },
  { why: "IČ DPH equal to SK + DIČ raises no notice", values: { icDph: "SK2020372640", dic: "2020372640" }, verdict: "valid", findings: [] },
  {
    why: "a bad IČ DPH gets its mismatch, not also a group notice",
    values: { icDph: "SK2020311335", dic: "2020372640" },
    verdict: "mismatch",
    findings: ["icDph:icdph-mod11:mismatch"],
  },
  {
    why: "a mismatch outranks a notice on the same party",
    values: { ico: "31333531", icDph: "SK7120001713", dic: "2020372640" },
    verdict: "mismatch",
    findings: ["ico:ico-checksum:mismatch", "icDph:vat-group:notice"],
  },
]);

// --- Unverifiable -----------------------------------------------------------

runRows([
  { why: "a party with no identifiers at all is unverifiable", values: {}, verdict: "unverifiable", findings: [] },
  { why: "a party with only a name is unverifiable", values: { name: "Dodávateľ bez IČO" }, verdict: "unverifiable", findings: [] },
  {
    why: "a foreign VAT ID without an IČO is unverifiable",
    values: { name: "Foreign GmbH", icDph: "DE123456789" },
    verdict: "unverifiable",
    findings: [],
  },
  { why: "a foreign VAT ID with an IČO is judged on the IČO", values: { ico: "31322832", icDph: "IE1234567A" }, verdict: "valid", findings: [] },
  { why: "a Slovak IČ DPH without an IČO is checked", values: { icDph: "SK2020372640" }, verdict: "valid", findings: [] },
]);

// --- Register and VIES answers: unavailable is honoured, answers are not yet used

test("an unavailable register leaves the offline checks in force as unavailable", () => {
  const check = checkSubject({
    party: party({ ico: "31322832" }),
    isClientParty: false,
    register: { unavailable: true },
  });
  assert.equal(check.verdict, "unavailable");
  assert.deepEqual(check.findings, []);
});

test("an offline mismatch outranks an unavailable register", () => {
  const check = checkSubject({
    party: party({ ico: "31333531" }),
    isClientParty: false,
    register: { unavailable: true },
  });
  assert.equal(check.verdict, "mismatch");
});

test("an unavailable VIES leaves a notice in place", () => {
  const check = checkSubject({
    party: party({ icDph: "SK2023141351", dic: "2020372640" }),
    isClientParty: false,
    vies: { unavailable: true },
  });
  assert.equal(check.verdict, "notice");
});

test("an unavailable check with nothing to verify is unavailable, not unverifiable", () => {
  const check = checkSubject({
    party: party({}),
    isClientParty: false,
    vies: { unavailable: true },
  });
  assert.equal(check.verdict, "unavailable");
});

test("a register answer is compared with the party; VIES is still an extension point", () => {
  const check = checkSubject({
    party: { name: "", ico: "31322832", dic: "", icDph: "" },
    isClientParty: false,
    register: { legalName: "Something else, a. s.", formerNames: [], dic: "1111111111", status: "dissolved" },
    vies: { valid: false, holderName: null },
  });
  assert.equal(check.verdict, "notice", "the register says the company is dissolved");
  assert.deepEqual(check.findings.map((item) => item.code), ["register-dissolved"]);
});

// --- The client's own party against the company profile ---------------------

function client(values: Partial<PartyIdentity>): SubjectCheck {
  return checkSubject({ party: party(values), isClientParty: true, profile: PROFILE });
}

test("the client's party matching the profile is verified", () => {
  const check = client({ name: "DELTA a.s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" });
  assert.equal(check.verdict, "verified");
  assert.deepEqual(check.findings, []);
});

test("a legal-form-only difference in the client's name is not a finding", () => {
  assert.equal(client({ name: "Delta s. r. o.", ico: "31322832" }).verdict, "verified");
  assert.equal(client({ name: "delta, a.s." }).verdict, "verified");
});

test("a client whose IČO differs from the profile is a mismatch naming the profile's IČO", () => {
  const check = client({ name: "Delta, a. s.", ico: "50861930" });
  assert.equal(check.verdict, "mismatch");
  assert.deepEqual(summary(check), ["ico:profile-ico:mismatch"]);
  assert.equal(check.findings[0]!.expected, "31322832");
  assert.equal(check.findings[0]!.printed, "50861930");
});

test("a client whose name differs from the profile is a mismatch naming the profile's name", () => {
  const check = client({ name: "Gamma, a. s.", ico: "31322832" });
  assert.equal(check.verdict, "mismatch");
  assert.deepEqual(summary(check), ["name:profile-name:mismatch"]);
  assert.equal(check.findings[0]!.expected, "Delta, a. s.");
});

test("a client whose DIČ differs from the profile is a mismatch naming the profile's DIČ", () => {
  const check = client({ ico: "31322832", dic: "2020311335" });
  assert.deepEqual(summary(check), ["dic:profile-dic:mismatch"]);
  assert.equal(check.findings[0]!.expected, "2020372640");
});

test("a client whose IČ DPH differs from the profile is a mismatch naming the profile's IČ DPH", () => {
  const check = client({ ico: "31322832", icDph: "SK2023141351" });
  assert.equal(check.verdict, "mismatch");
  assert.deepEqual(summary(check), ["icDph:profile-icdph:mismatch"]);
  assert.equal(check.findings[0]!.expected, "SK2020372640");
});

test("a client's VAT prefix of another country than the profile is a mismatch", () => {
  const czechProfile: ClientIdentity = { country: "CZ", legalName: "Delta, s.r.o.", ico: "25596641", dic: "CZ25596641", icDph: "" };
  const check = checkSubject({
    party: party({ ico: "25596641", icDph: "SK2020372640" }),
    isClientParty: true,
    profile: czechProfile,
  });
  assert.equal(check.verdict, "mismatch");
  assert.deepEqual(summary(check), ["icDph:profile-country:mismatch"]);
  assert.equal(check.findings[0]!.expected, "CZ");
});

test("a profile without an IČ DPH yet compares nothing on that field", () => {
  const noVat: ClientIdentity = { ...PROFILE, icDph: "" };
  const check = checkSubject({ party: party({ ico: "31322832", icDph: "SK2023141351" }), isClientParty: true, profile: noVat });
  assert.equal(check.verdict, "verified");
  assert.deepEqual(check.findings, []);
});

test("a client named only by its name is verified on the name", () => {
  assert.equal(client({ name: "Delta, a. s." }).verdict, "verified");
});

test("a client with nothing printed cannot be verified", () => {
  assert.equal(client({}).verdict, "unverifiable");
});

test("the counterparty is never checked against the profile", () => {
  const check = checkSubject({
    party: party({ name: "Gamma, a. s.", ico: "50861930" }),
    isClientParty: false,
    profile: PROFILE,
  });
  assert.equal(check.verdict, "valid");
  assert.deepEqual(check.findings, []);
});

test("without a profile the client's party is judged offline only", () => {
  const check = checkSubject({ party: party({ name: "Gamma, a. s.", ico: "50861930" }), isClientParty: true, profile: null });
  assert.equal(check.verdict, "valid");
});

// --- Which side is hers ------------------------------------------------------

test("the client side is the supplier of an issued invoice and the customer of a received one", () => {
  const empty = party({});
  assert.equal(clientSideOf({ folderSlot: "01 Vystavené faktúry", supplier: empty, customer: empty, profile: PROFILE }), "supplier");
  assert.equal(clientSideOf({ folderSlot: "02 Prijaté faktúry", supplier: empty, customer: empty, profile: PROFILE }), "customer");
  assert.equal(clientSideOf({ folderSlot: "02 Prijaté faktúry", supplier: empty, customer: empty, profile: null }), "customer");
});

test("a folder without a side identifies hers by the IČO that matches the profile", () => {
  const hers = party({ name: "Delta, a. s.", ico: "31322832" });
  const other = party({ name: "Gamma", ico: "50861930" });
  assert.equal(clientSideOf({ folderSlot: "04 Bločky", supplier: hers, customer: other, profile: PROFILE }), "supplier");
  assert.equal(clientSideOf({ folderSlot: "04 Bločky", supplier: other, customer: hers, profile: PROFILE }), "customer");
  assert.equal(clientSideOf({ folderSlot: "04 Bločky", supplier: hers, customer: hers, profile: PROFILE }), null);
  assert.equal(clientSideOf({ folderSlot: "04 Bločky", supplier: other, customer: other, profile: PROFILE }), null);
  assert.equal(clientSideOf({ folderSlot: "04 Bločky", supplier: hers, customer: other, profile: null }), null);
});

// --- Both parties, and the verdicts moving with a swap -----------------------

test("the verdicts move with the parties through a swap", () => {
  const hers = party({ name: "Delta, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" });
  const theirs = party({ name: "Beta s.r.o.", ico: "50861930" });

  // Her company sits on the supplier side of a received invoice: wrong.
  const before = checkBothParties({ folderSlot: "02 Prijaté faktúry", supplier: hers, customer: theirs, profile: PROFILE });
  assert.equal(before.supplier.verdict, "valid");
  assert.equal(before.customer.verdict, "mismatch");

  // After the swap her company is the customer, and her side is verified.
  const after = checkBothParties({ folderSlot: "02 Prijaté faktúry", supplier: theirs, customer: hers, profile: PROFILE });
  assert.equal(after.supplier.verdict, "valid");
  assert.equal(after.customer.verdict, "verified");
});

// --- Messages and labels -----------------------------------------------------

test("every finding has a Slovak message, naming the expected value when there is one", () => {
  const profileIco = client({ ico: "50861930", name: "Delta, a. s." }).findings[0]!;
  assert.match(subjectFindingMessage(profileIco), /31322832/);
  const group = offline({ icDph: "SK2023141351", dic: "2020372640" }).findings[0]!;
  assert.match(subjectFindingMessage(group), /SK2020372640/);
  const checksum = offline({ ico: "31333531" }).findings[0]!;
  assert.match(subjectFindingMessage(checksum), /IČO/);
});

test("the verdict labels are the Slovak words the panel shows", () => {
  assert.equal(verdictLabel("verified"), "Overené");
  assert.equal(verdictLabel("valid"), "Formálne v poriadku");
  assert.equal(verdictLabel("notice"), "Upozornenie");
  assert.equal(verdictLabel("mismatch"), "Nesúhlasí");
  assert.equal(verdictLabel("unverifiable"), "Nedá sa overiť");
  assert.equal(verdictLabel("unavailable"), "Overenie nedostupné");
});

test("the document's fields are judged as its two parties, with her side from the folder", () => {
  const fields = {
    supplierName: "Beta s.r.o.",
    ico: "50861930",
    dic: "",
    icDph: "",
    customerName: "Delta, a. s.",
    customerIco: "31322832",
    customerDic: "2020372640",
    customerIcDph: "SK2020372640",
  };
  const judged = checkDocumentParties({ folderSlot: "02 Prijaté faktúry", fields, profile: PROFILE });
  assert.equal(judged.supplier.verdict, "valid");
  assert.equal(judged.customer.verdict, "verified");
  // Exchanged, her company sits on the supplier side of a received invoice: she is not the customer.
  const swapped = checkDocumentParties({
    folderSlot: "02 Prijaté faktúry",
    fields: {
      ...fields,
      supplierName: fields.customerName,
      ico: fields.customerIco,
      dic: fields.customerDic,
      icDph: fields.customerIcDph,
      customerName: fields.supplierName,
      customerIco: fields.ico,
      customerDic: fields.dic,
      customerIcDph: fields.icDph,
    },
    profile: PROFILE,
  });
  assert.equal(swapped.supplier.verdict, "valid");
  assert.equal(swapped.customer.verdict, "mismatch");
});

test("a finding carries no expected value when none exists", () => {
  const check = offline({ ico: "31333531" });
  assert.deepEqual(check.findings[0], {
    field: "ico",
    code: "ico-checksum",
    severity: "mismatch",
    printed: "31333531",
  });
});
