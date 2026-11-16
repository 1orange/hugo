import type { CompanyProfileFields } from "./company-profile";
import { coreCompanyName } from "./register-search";

export type PartyRole = "supplier" | "customer";

export type EnrichedParty = {
  name: string;
  ico: string;
  dic: string;
  icDph: string;
};

export type PartyField = keyof EnrichedParty;
/**
 * Where a party value came from. `register`: the accountant took it from the
 * register (PRD 0004, story 34); `directory`: filled from a known subject of
 * the shared directory (ADR 0022). Both yield to anything typed.
 */
export type PartyValueProvenance =
  | "empty"
  | "extracted"
  | "confirmed"
  | "profile"
  | "derived"
  | "register"
  | "directory";

export type PartyFieldValue = {
  value: string;
  provenance: PartyValueProvenance;
};

export type PartySource = Record<PartyField, PartyFieldValue>;

export type PartyEnrichmentResult = {
  supplier: PartySource;
  customer: PartySource;
  conflicts: Record<PartyRole, boolean>;
};

export type PartyEnrichmentProfile = Pick<
  CompanyProfileFields,
  "country" | "ico" | "icDph"
> & Partial<Pick<CompanyProfileFields, "dic" | "legalName">>;

const PARTY_FIELDS: readonly PartyField[] = ["name", "ico", "dic", "icDph"];

function emptyParty(): PartySource {
  return {
    name: { value: "", provenance: "empty" },
    ico: { value: "", provenance: "empty" },
    dic: { value: "", provenance: "empty" },
    icDph: { value: "", provenance: "empty" },
  };
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

/**
 * A Slovak IČ DPH is the DIČ with an SK prefix. Delimiters and case are
 * normalized, but no other country or malformed number is accepted.
 */
export function deriveDicFromSlovakIcDph(icDph: string | null | undefined): string | null {
  const normalized = compact(icDph ?? "").toUpperCase();
  return /^SK\d{10}$/.test(normalized) ? normalized.slice(2) : null;
}

function sameIdentityValue(field: PartyField, left: string, right: string): boolean {
  if (field === "name") {
    return coreCompanyName(left) === coreCompanyName(right);
  }
  return compact(left).toUpperCase() === compact(right).toUpperCase();
}

function expectedRole(folderSlot: string): PartyRole | null {
  if (folderSlot.startsWith("01 ")) {
    return "supplier";
  }
  if (folderSlot.startsWith("02 ")) {
    return "customer";
  }
  return null;
}

function profileValue(profile: PartyEnrichmentProfile, field: PartyField): string {
  if (field === "name") {
    return profile.legalName?.trim() ?? "";
  }
  return profile[field]?.trim() ?? "";
}

/** What the shared subject directory knows of a party's subject, for the fields it may fill. */
export type DirectoryPartyFacts = {
  name: string;
  dic: string;
  icDph: string;
};

/** The directory's facts by subject key (see directoryKeyOf): the pages look them up, never a register. */
export type DirectoryFactsByKey = Record<string, DirectoryPartyFacts>;

/**
 * Fills what a party lacks from its subject (ADR 0022): a missing DIČ or IČ DPH,
 * and the name only when the party has none. A value that is printed or was
 * typed is never replaced, and a field the accountant emptied on purpose
 * (provenance `confirmed`, no value) stays empty.
 */
export function fillFromDirectory(party: PartySource, facts: DirectoryPartyFacts | undefined): PartySource {
  if (!facts) {
    return party;
  }
  const next = cloneParty(party);
  for (const field of ["name", "dic", "icDph"] as const) {
    const value = facts[field].trim();
    const current = next[field];
    if (value.length === 0 || current.value.trim().length > 0 || current.provenance === "confirmed") {
      continue;
    }
    next[field] = { value, provenance: "directory" };
  }
  return next;
}

function cloneParty(party: PartySource): PartySource {
  return Object.fromEntries(
    PARTY_FIELDS.map((field) => [field, { ...party[field] }]),
  ) as PartySource;
}

/**
 * Complete both parties without changing populated document values. Profile
 * data is projected only onto the role asserted by the invoice folder; the
 * other party remains independent. DIČ derivation applies to either party.
 */
export function enrichInvoiceParties(input: {
  folderSlot: string;
  supplier: PartySource;
  customer: PartySource;
  profile?: PartyEnrichmentProfile | null;
  enabled?: boolean;
}): PartyEnrichmentResult {
  const result: PartyEnrichmentResult = {
    supplier: cloneParty(input.supplier),
    customer: cloneParty(input.customer),
    conflicts: { supplier: false, customer: false },
  };
  const role = expectedRole(input.folderSlot);

  if (input.enabled !== false) {
    for (const role of ["supplier", "customer"] as const) {
      // For the client role, a register-provided DIČ is authoritative when
      // available. Derive only after profile backfill below, so a VAT-group
      // IČ DPH cannot spuriously conflict with the profile's separate DIČ.
      if (role === expectedRole(input.folderSlot)) {
        continue;
      }
      const party = result[role];
      if (party.dic.value.trim().length === 0) {
        const derived = deriveDicFromSlovakIcDph(party.icDph.value);
        if (derived) {
          party.dic = { value: derived, provenance: "derived" };
        }
      }
    }
  }

  if (input.enabled === false || !role || !input.profile) {
    if (input.enabled !== false && role && !input.profile) {
      const party = result[role];
      if (party.dic.value.trim().length === 0) {
        const derived = deriveDicFromSlovakIcDph(party.icDph.value);
        if (derived) {
          party.dic = { value: derived, provenance: "derived" };
        }
      }
    }
    return result;
  }

  const party = result[role];
  for (const field of PARTY_FIELDS) {
    const profileField = profileValue(input.profile, field);
    if (!profileField) {
      continue;
    }
    if (party[field].value.trim().length > 0) {
      if (!sameIdentityValue(field, party[field].value, profileField)) {
        result.conflicts[role] = true;
      }
      continue;
    }
    party[field] = { value: profileField, provenance: "profile" };
  }

  // A profile may contain IČ DPH while its register record has no DIČ.
  if (party.dic.value.trim().length === 0) {
    const derived = deriveDicFromSlovakIcDph(party.icDph.value);
    if (derived) {
      party.dic = { value: derived, provenance: "derived" };
    }
  }

  return result;
}

export function partySourceFromValues(
  values: Partial<Record<PartyField, string | null | undefined>>,
  provenance: PartyValueProvenance = "extracted",
): PartySource {
  const party = emptyParty();
  for (const field of PARTY_FIELDS) {
    const value = values[field]?.trim() ?? "";
    party[field] = {
      value,
      provenance: value ? provenance : "empty",
    };
  }
  return party;
}
