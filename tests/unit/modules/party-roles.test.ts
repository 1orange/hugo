import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignPartiesFromExtracted,
  partyMatchesClient,
  partyRoleIndices,
  validateLabeledPartyRoles,
} from "../../../src/modules/party-roles.ts";
import type { CompanyProfileFields } from "../../../src/modules/company-profile.ts";
import type { DocumentParty } from "../../../src/modules/document-payload.ts";

const skProfile: Pick<CompanyProfileFields, "country" | "ico" | "icDph"> = {
  country: "SK",
  ico: "31333532",
  icDph: "SK7120001713",
};

const czProfile: Pick<CompanyProfileFields, "country" | "ico" | "icDph"> = {
  country: "CZ",
  ico: "12345678",
  icDph: "CZ12345678",
};

test("partyMatchesClient requires matching IČO", () => {
  const party: DocumentParty = {
    name: "Beta s.r.o.",
    ico: "31333532",
    dic: null,
    icDph: null,
  };
  assert.equal(partyMatchesClient(party, skProfile), true);
  assert.equal(partyMatchesClient({ ...party, ico: "99999999" }, skProfile), false);
});

test("partyMatchesClient disambiguates SK and CZ companies sharing an IČO", () => {
  const skParty: DocumentParty = {
    name: "SK firm",
    ico: "12345678",
    dic: null,
    icDph: "SK2020311335",
  };
  const czParty: DocumentParty = {
    name: "CZ firm",
    ico: "12345678",
    dic: null,
    icDph: "CZ12345678",
  };
  assert.equal(partyMatchesClient(skParty, skProfile), false);
  assert.equal(partyMatchesClient(czParty, skProfile), false);
  assert.equal(partyMatchesClient(skParty, { ...skProfile, ico: "12345678", icDph: "SK2020311335" }), true);
  assert.equal(partyMatchesClient(czParty, czProfile), true);
});

// MODIVO's invoice names the customer with its DIČ only, no IČO.
test("a party without an IČO is her company by DIČ, IČ DPH or name", () => {
  const profile = { country: "SK" as const, ico: "36123456", dic: "2020123456", icDph: "SK2020123456", legalName: "Modrá hora s. r. o." };
  const unnamed = { name: null, ico: null, dic: null, icDph: null };
  assert.equal(partyMatchesClient({ ...unnamed, dic: "2020123456" }, profile), true);
  assert.equal(partyMatchesClient({ ...unnamed, icDph: "SK2020123456" }, profile), true);
  assert.equal(partyMatchesClient({ ...unnamed, name: "Modrá hora s.r.o." }, profile), true);
  assert.equal(partyMatchesClient({ ...unnamed, name: "MODIVO.com S.A.", icDph: "SK4120004493" }, profile), false);
  // An IČO that is not hers settles it, whatever the name.
  assert.equal(partyMatchesClient({ ...unnamed, name: "Modrá hora s.r.o.", ico: "99999999" }, profile), false);
});

test("the MODIVO invoice: supplier and customer found without her IČO", () => {
  const profile = { country: "SK" as const, ico: "36123456", dic: "2020123456", icDph: "SK2020123456", legalName: "Modrá hora s. r. o." };
  const assigned = assignPartiesFromExtracted({
    folderSlot: "02 Prijaté faktúry",
    profile,
    parties: [
      { name: "Modrá hora s.r.o.", ico: null, dic: "2020123456", icDph: null },
      { name: "MODIVO.com S.A.", ico: null, dic: null, icDph: "SK4120004493" },
    ],
  });
  assert.equal(assigned.supplier.name, "MODIVO.com S.A.");
  assert.equal(assigned.customer.name, "Modrá hora s.r.o.");
  assert.equal(assigned.rolesFlagged, false);
});

// With roles unknown the fields show the parties in the order read; their
// checks must come from the same party.
test("with her company not found, the checks follow the parties' order", () => {
  const parties = [
    { name: "Dodávateľ s.r.o.", ico: "87654321", dic: null, icDph: null },
    { name: "Iný s.r.o.", ico: "11111111", dic: null, icDph: null },
  ];
  assert.deepEqual(partyRoleIndices({ parties, profile: skProfile, folderSlot: "02 Prijaté faktúry" }), {
    supplierIndex: 0,
    customerIndex: 1,
  });
  const assigned = assignPartiesFromExtracted({ folderSlot: "02 Prijaté faktúry", profile: skProfile, parties });
  assert.equal(assigned.supplier.name, "Dodávateľ s.r.o.");
});

test("assignPartiesFromExtracted: received invoice — client is customer", () => {
  const supplier: DocumentParty = {
    name: "Dodávateľ s.r.o.",
    ico: "87654321",
    dic: "8765432100",
    icDph: "SK8765432100",
  };
  const customer: DocumentParty = {
    name: "Beta s.r.o.",
    ico: "31333532",
    dic: "2020311335",
    icDph: "SK7120001713",
  };
  const assigned = assignPartiesFromExtracted({
    folderSlot: "02 Prijaté faktúry",
    profile: skProfile,
    parties: [supplier, customer],
  });
  assert.equal(assigned.rolesFlagged, false);
  assert.equal(assigned.supplier.name, "Dodávateľ s.r.o.");
  assert.equal(assigned.customer.name, "Beta s.r.o.");
});

test("assignPartiesFromExtracted: issued invoice — client is supplier", () => {
  const supplier: DocumentParty = {
    name: "Beta s.r.o.",
    ico: "31333532",
    dic: "2020311335",
    icDph: "SK7120001713",
  };
  const customer: DocumentParty = {
    name: "Odberateľ a.s.",
    ico: "11111111",
    dic: null,
    icDph: null,
  };
  const assigned = assignPartiesFromExtracted({
    folderSlot: "01 Vystavené faktúry",
    profile: skProfile,
    parties: [customer, supplier],
  });
  assert.equal(assigned.rolesFlagged, false);
  assert.equal(assigned.supplier.name, "Beta s.r.o.");
  assert.equal(assigned.customer.name, "Odberateľ a.s.");
});

test("assignPartiesFromExtracted flags when neither party matches the profile", () => {
  const assigned = assignPartiesFromExtracted({
    folderSlot: "02 Prijaté faktúry",
    profile: skProfile,
    parties: [
      { name: "A", ico: "11111111", dic: null, icDph: null },
      { name: "B", ico: "22222222", dic: null, icDph: null },
    ],
  });
  assert.equal(assigned.rolesFlagged, true);
});

test("assignPartiesFromExtracted without profile leaves roles flagged", () => {
  const assigned = assignPartiesFromExtracted({
    folderSlot: "02 Prijaté faktúry",
    profile: null,
    parties: [
      { name: "A", ico: "11111111", dic: null, icDph: null },
      { name: "B", ico: "22222222", dic: null, icDph: null },
    ],
  });
  assert.equal(assigned.missingProfile, true);
  assert.equal(assigned.rolesFlagged, true);
});

test("validateLabeledPartyRoles flags misfiled received invoice", () => {
  const result = validateLabeledPartyRoles({
    folderSlot: "02 Prijaté faktúry",
    profile: skProfile,
    supplier: { name: "Beta", ico: "31333532", dic: "", icDph: "SK7120001713" },
    customer: { name: "Other", ico: "87654321", dic: "", icDph: "" },
  });
  assert.equal(result.rolesFlagged, true);
});
