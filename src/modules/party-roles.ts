import type { CompanyProfileFields } from "./company-profile";
import type { DocumentParty } from "./document-payload";

export type PartyIdentity = {
  name: string;
  ico: string;
  dic: string;
  icDph: string;
};

export type PartyRoleAssignment = {
  supplier: PartyIdentity;
  customer: PartyIdentity;
  rolesFlagged: boolean;
  missingProfile: boolean;
};

export type PartyRoleValidation = {
  rolesFlagged: boolean;
  missingProfile: boolean;
};

function emptyIdentity(): PartyIdentity {
  return { name: "", ico: "", dic: "", icDph: "" };
}

function normalizeIco(value: string): string {
  return value.replace(/\s/g, "");
}

function vatCountryPrefix(vatId: string): CompanyProfileFields["country"] | null {
  const upper = vatId.trim().toUpperCase();
  if (upper.startsWith("SK")) {
    return "SK";
  }
  if (upper.startsWith("CZ")) {
    return "CZ";
  }
  return null;
}

function partyToIdentity(party: DocumentParty): PartyIdentity {
  return {
    name: party.name?.trim() ?? "",
    ico: party.ico?.trim() ?? "",
    dic: party.dic?.trim() ?? "",
    icDph: party.icDph?.trim() ?? "",
  };
}

/** Her company as the documents name it; DIČ and name when the profile has them. */
export type ClientIdentity = Pick<CompanyProfileFields, "country" | "ico" | "icDph"> &
  Partial<Pick<CompanyProfileFields, "dic" | "legalName">>;

function compactName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Whether the party is her company. By IČO; a party without one — MODIVO's
 * invoice prints only the customer's DIČ — by DIČ, IČ DPH or name.
 */
export function partyMatchesClient(party: DocumentParty, profile: ClientIdentity): boolean {
  const partyIco = normalizeIco(party.ico ?? "");
  if (partyIco.length === 0) {
    return partyMatchesClientWithoutIco(party, profile);
  }
  const profileIco = normalizeIco(profile.ico);
  if (partyIco !== profileIco) {
    return false;
  }

  const partyVat = (party.icDph ?? "").trim();
  const profileVat = profile.icDph.trim();
  if (partyVat.length > 0) {
    const partyCountry = vatCountryPrefix(partyVat);
    if (partyCountry && partyCountry !== profile.country) {
      return false;
    }
  }
  if (profileVat.length > 0 && partyVat.length > 0) {
    const profileCountry = vatCountryPrefix(profileVat);
    const partyCountry = vatCountryPrefix(partyVat);
    if (profileCountry && partyCountry && profileCountry !== partyCountry) {
      return false;
    }
  }

  return true;
}

function partyMatchesClientWithoutIco(party: DocumentParty, profile: ClientIdentity): boolean {
  const same = (left: string | null | undefined, right: string | null | undefined) => {
    const a = (left ?? "").replace(/\s/g, "").toUpperCase();
    return a.length > 0 && a === (right ?? "").replace(/\s/g, "").toUpperCase();
  };
  if (same(party.icDph, profile.icDph) || same(party.dic, profile.dic)) {
    return true;
  }
  const name = compactName(party.name ?? "");
  return name.length > 0 && name === compactName(profile.legalName ?? "");
}

export function clientPartyIndex(parties: DocumentParty[], profile: ClientIdentity): number | null {
  const matches = parties
    .map((party, index) => (partyMatchesClient(party, profile) ? index : -1))
    .filter((index) => index >= 0);
  if (matches.length !== 1) {
    return null;
  }
  return matches[0]!;
}

function isReceivedInvoices(folderSlot: string): boolean {
  return folderSlot.startsWith("02 ");
}

function isIssuedInvoices(folderSlot: string): boolean {
  return folderSlot.startsWith("01 ");
}

export function partyRoleIndices(input: {
  parties: DocumentParty[];
  profile: ClientIdentity | null;
  folderSlot: string;
}): { supplierIndex: number; customerIndex: number } {
  if (input.parties.length === 0) {
    return { supplierIndex: 0, customerIndex: 1 };
  }
  if (!input.profile) {
    return { supplierIndex: 0, customerIndex: Math.min(1, input.parties.length - 1) };
  }

  const clientIndex = clientPartyIndex(input.parties, input.profile);
  // Unknown roles keep the order the parties were read in, as
  // assignPartiesFromExtracted does: the checks shown beside the supplier's
  // fields must be the supplier's.
  if (clientIndex === null) {
    return { supplierIndex: 0, customerIndex: Math.min(1, input.parties.length - 1) };
  }
  const client = clientIndex;
  const counterparty = client === 0 ? 1 : 0;

  if (isReceivedInvoices(input.folderSlot)) {
    return { supplierIndex: counterparty, customerIndex: client };
  }
  if (isIssuedInvoices(input.folderSlot)) {
    return { supplierIndex: client, customerIndex: counterparty };
  }
  return { supplierIndex: 0, customerIndex: Math.min(1, input.parties.length - 1) };
}

export function assignPartiesFromExtracted(input: {
  folderSlot: string;
  profile: ClientIdentity | null;
  parties: DocumentParty[];
}): PartyRoleAssignment {
  const first = input.parties[0] ? partyToIdentity(input.parties[0]) : emptyIdentity();
  const second = input.parties[1] ? partyToIdentity(input.parties[1]) : emptyIdentity();

  if (!input.profile) {
    return {
      supplier: first,
      customer: second,
      rolesFlagged: true,
      missingProfile: true,
    };
  }

  const clientIndex = clientPartyIndex(input.parties, input.profile);
  if (clientIndex === null) {
    return {
      supplier: first,
      customer: second,
      rolesFlagged: true,
      missingProfile: false,
    };
  }

  const client = partyToIdentity(input.parties[clientIndex]!);
  const counterparty = partyToIdentity(
    input.parties[clientIndex === 0 ? 1 : 0] ?? { name: null, ico: null, dic: null, icDph: null },
  );

  if (isReceivedInvoices(input.folderSlot)) {
    return {
      supplier: counterparty,
      customer: client,
      rolesFlagged: false,
      missingProfile: false,
    };
  }
  if (isIssuedInvoices(input.folderSlot)) {
    return {
      supplier: client,
      customer: counterparty,
      rolesFlagged: false,
      missingProfile: false,
    };
  }

  return {
    supplier: first,
    customer: second,
    rolesFlagged: true,
    missingProfile: false,
  };
}

export function validateLabeledPartyRoles(input: {
  folderSlot: string;
  profile: ClientIdentity | null;
  supplier: PartyIdentity;
  customer: PartyIdentity;
}): PartyRoleValidation {
  if (!input.profile) {
    return { rolesFlagged: true, missingProfile: true };
  }

  const supplierMatches = partyMatchesClient(
    {
      name: input.supplier.name,
      ico: input.supplier.ico,
      dic: input.supplier.dic,
      icDph: input.supplier.icDph,
    },
    input.profile,
  );
  const customerMatches = partyMatchesClient(
    {
      name: input.customer.name,
      ico: input.customer.ico,
      dic: input.customer.dic,
      icDph: input.customer.icDph,
    },
    input.profile,
  );

  if (isReceivedInvoices(input.folderSlot)) {
    return {
      rolesFlagged: !customerMatches || supplierMatches,
      missingProfile: false,
    };
  }
  if (isIssuedInvoices(input.folderSlot)) {
    return {
      rolesFlagged: !supplierMatches || customerMatches,
      missingProfile: false,
    };
  }

  return { rolesFlagged: !supplierMatches && !customerMatches, missingProfile: false };
}
