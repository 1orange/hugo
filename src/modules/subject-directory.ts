import type { PartyIdentity } from "./party-roles";
import {
  comparableDic,
  comparableHolderName,
  countryOf,
  isGroupRegistrationHolder,
  type RegisterAnswer,
  type Unavailable,
  type ViesAnswer,
} from "./subject-integrity";
import { coreCompanyName, normalizeCompanyName } from "./register-search";

/**
 * The rules of the shared subject directory (ADR 0022), without the database:
 * how a party is keyed, when register data is stale, what a register answer
 * changes, and which manual corrections it must not overwrite.
 */

export type SubjectCountry = "SK" | "CZ" | "foreign";
export type SubjectRegisterStatus = "active" | "dissolved" | "unknown";
/**
 * Where a value came from. `sheet` is the office's client sheet (0005/09): neither a
 * register's answer nor her typing, so it is not yet confirmed by a register check.
 */
export type SubjectSource = "register" | "vies" | "manual" | "sheet";
export type SubjectField =
  | "legalName"
  | "formerNames"
  | "dic"
  | "icDph"
  | "address"
  | "registerStatus"
  | "vatGroupId";

/** The fields an accountant may correct; a refresh never overwrites these (ADR 0022). */
export const MANUAL_SUBJECT_FIELDS: readonly SubjectField[] = ["legalName", "dic", "icDph", "address", "vatGroupId"];

/**
 * One VIES answer about one VAT ID of a subject (ADR 0022: VIES status kept with
 * the subject). `lapsedAt` is set when a number VIES had confirmed is no longer
 * registered; it clears when VIES confirms the number again.
 */
export type ViesRecord = {
  valid: boolean;
  holderName: string | null;
  checkedAt: string;
  lapsedAt: string | null;
};

/** The VIES answers a subject holds, by normalised VAT ID. */
export type ViesStatusMap = Record<string, ViesRecord>;

/** The European VAT prefixes VIES answers for (EL is Greece's; XI is Northern Ireland's). */
const VIES_PREFIXES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI",
]);

export type SubjectFinding = {
  field: SubjectField;
  kind: "register-disagrees";
  /** The value the register holds. */
  value: string;
  at: string;
};

/** The subject as the rules read it: the directory row, values only. */
export type SubjectState = {
  country: SubjectCountry;
  ico: string | null;
  vatId: string | null;
  legalName: string | null;
  formerNames: string[];
  dic: string | null;
  icDph: string | null;
  address: string | null;
  registerStatus: SubjectRegisterStatus;
  sources: Partial<Record<SubjectField, SubjectSource>>;
  manualFields: SubjectField[];
  findings: SubjectFinding[];
  verifiedAt: string | null;
};

export type SubjectKey = {
  country: SubjectCountry;
  /** Set for an SK or CZ subject with its IČO. */
  ico: string | null;
  /** Normalised VAT ID, when the party printed one. */
  vatId: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function compact(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "");
}

/** The subject's country from its numbers; null when they do not say. */
export function subjectCountryOf(party: PartyIdentity): SubjectCountry | null {
  const country = countryOf(party);
  if (country) {
    return country;
  }
  // A Slovak DIČ is ten digits and carries no prefix; a Czech one has CZ.
  return /^\d{10}$/.test(compact(party.dic)) ? "SK" : null;
}

/** The VAT ID a party prints, normalised: IČ DPH, or the CZ DIČ, or a foreign party's VAT ID. */
export function vatIdOf(party: PartyIdentity, country: SubjectCountry | null): string | null {
  const icDph = compact(party.icDph).toUpperCase();
  const dic = compact(party.dic).toUpperCase();
  if (icDph) {
    return icDph;
  }
  if (dic.startsWith("CZ") || country === "foreign") {
    return dic || null;
  }
  return null;
}

/**
 * What a party resolves a subject by (ADR 0022): its IČO for an SK or CZ
 * subject, otherwise its normalised VAT ID. Null when the party carries neither.
 */
export function subjectKeyOf(party: PartyIdentity, country: SubjectCountry | null): SubjectKey | null {
  const vatId = vatIdOf(party, country);
  const ico = compact(party.ico);
  if (country && country !== "foreign" && /^\d{8}$/.test(ico)) {
    return { country, ico, vatId };
  }
  if (vatId) {
    return { country: country ?? "foreign", ico: null, vatId };
  }
  return null;
}

/** Register data is stale once it is `refreshDays` old, and never fetched is stale too. */
export function isStale(verifiedAt: string | null, now: string, refreshDays: number): boolean {
  if (!verifiedAt) {
    return true;
  }
  const age = Date.parse(now) - Date.parse(verifiedAt);
  return !(age < refreshDays * DAY_MS);
}

/** The key a subject is stored by, as a string: "SK:31333532", or "vat:…" for a subject without an IČO. */
export function keyStringOf(key: SubjectKey): string {
  return key.ico ? `${key.country}:${key.ico}` : `vat:${key.vatId ?? ""}`;
}

/**
 * The directory key a party's values are filled from. A party whose country is
 * known is keyed as the subject lookup keys it; one with an IČO but no country
 * signal (no DIČ, no IČ DPH) is keyed by its IČO alone, and is filled from the
 * Slovak subject holding it in the register, else the Czech one. Null when there is no IČO to go by.
 */
export function directoryKeyOf(party: PartyIdentity): string | null {
  const key = subjectKeyOf(party, subjectCountryOf(party));
  if (key) {
    return keyStringOf(key);
  }
  const ico = compact(party.ico);
  return /^\d{8}$/.test(ico) ? `ico:${ico}` : null;
}

/** The key of an alias: the name lowercased, without diacritics, legal punctuation or spacing. */
export function aliasKeyOf(name: string): string {
  return normalizeCompanyName(name);
}

/**
 * The subject a name points to by its alias: the one it was printed under most
 * often. Two subjects tied on the most sightings are no answer at all.
 */
export function pickAliasSubject<T>(candidates: Array<{ subject: T; count: number }>): T | null {
  if (candidates.length === 0) {
    return null;
  }
  const top = candidates[0]!.count;
  const leaders = candidates.filter((candidate) => candidate.count === top);
  return leaders.length === 1 ? leaders[0]!.subject : null;
}

/** What the subject says to the integrity checks, from what the directory holds. */
export function registerAnswerOf(subject: SubjectState): RegisterAnswer | null {
  if (!subject.legalName) {
    return null;
  }
  return {
    legalName: subject.legalName,
    formerNames: subject.formerNames,
    dic: subject.dic,
    status: subject.registerStatus === "dissolved" ? "dissolved" : "active",
  };
}

/** A register answer about the subject, as the register gave it. */
export type RegisterFacts = {
  legalName: string;
  formerNames: string[];
  dic: string | null;
  address: string;
  status: "active" | "dissolved";
};

export type SubjectUpdate = Partial<
  Pick<
    SubjectState,
    "legalName" | "formerNames" | "dic" | "address" | "registerStatus" | "sources" | "manualFields" | "findings"
  >
> & { verifiedAt: string };

/** A subject's own IČ DPH, as VIES confirmed it (see icDphConfirmedByVies). */
export type SubjectIcDphUpdate = {
  icDph: string;
  sources: SubjectState["sources"];
  /** Set when VIES confirms a number she had typed: it is the register's now, not hers alone. */
  manualFields?: SubjectField[];
};

/** A change to the subject's VAT group or VIES answers: no register was asked. */
export type SubjectVatUpdate = Partial<{
  vatGroupId: string | null;
  viesStatus: ViesStatusMap;
  sources: SubjectState["sources"];
  manualFields: SubjectField[];
}>;

/**
 * Whether two values of one identity field are the same thing: the spacing and the
 * letter case of a name or an address do not make it another one, and the DIČ's
 * country prefix does not either.
 */
export function sameIdentityValue(field: SubjectField, left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left ?? "";
  const b = right ?? "";
  if (field === "dic") {
    return comparableDic(a) === comparableDic(b);
  }
  if (field === "icDph") {
    return compact(a).toUpperCase() === compact(b).toUpperCase();
  }
  const words = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return words(a) === words(b);
}

/**
 * A field the register does not own: her own typing (`manual`), or a value another
 * source put there (the client sheet). A refresh keeps such a value and reports what
 * the register says; only a value the register or VIES confirmed is the register's.
 */
export function isKeptField(subject: SubjectState, field: SubjectField): boolean {
  if (subject.manualFields.includes(field)) {
    return true;
  }
  const source = (subject.sources as Partial<Record<string, string>>)[field];
  return source !== undefined && source !== "register" && source !== "vies";
}

/** The identity fields the register owns: a name, an address and a DIČ. */
type OwnedField = "legalName" | "address" | "dic";

/**
 * The directory's update for a fresh register answer (ADR 0022, 0006/03). A kept field
 * (see isKeptField) keeps its value: when the register says the same, the value becomes
 * the register's, confirmed; when it says otherwise, a `register-disagrees` finding
 * carries the register's value. Other fields take the register's value, source `register`.
 */
export function applyRegisterFacts(subject: SubjectState, facts: RegisterFacts, now: string): SubjectUpdate {
  const sources = { ...subject.sources };
  let manualFields = [...subject.manualFields];
  const findings = subject.findings.filter((finding) => finding.kind !== "register-disagrees");
  const update: SubjectUpdate = {
    formerNames: facts.formerNames,
    registerStatus: facts.status,
    verifiedAt: now,
  };
  sources.formerNames = "register";
  sources.registerStatus = "register";

  const owned: Array<[OwnedField, string | null]> = [
    ["legalName", facts.legalName],
    ["address", facts.address || null],
    ["dic", facts.dic],
  ];
  for (const [field, registerValue] of owned) {
    if (registerValue === null) {
      continue;
    }
    if (!isKeptField(subject, field)) {
      update[field] = registerValue;
      sources[field] = "register";
      continue;
    }
    if (sameIdentityValue(field, subject[field], registerValue)) {
      // Her value is the register's now: confirmed, so the register keeps it up to date from here on.
      sources[field] = "register";
      manualFields = manualFields.filter((kept) => kept !== field);
    } else {
      findings.push({ field, kind: "register-disagrees", value: registerValue, at: now });
    }
  }

  update.sources = sources;
  update.manualFields = manualFields;
  update.findings = findings;
  return update;
}

/** What a return to the register's value stores: the value, and the subject's state without the disagreement. */
export type RegisterRestoreUpdate = {
  value: string;
  sources: SubjectState["sources"];
  manualFields: SubjectField[];
  findings: SubjectFinding[];
};

/**
 * The one-click return to the register's value (0006/03): a field with a register
 * disagreement takes the value the register holds, its source becomes `register`, it
 * leaves the manual list, and the disagreement is resolved. Null when there is no
 * disagreement to return to.
 */
export function restoreRegisterValueOf(subject: SubjectState, field: SubjectField): RegisterRestoreUpdate | null {
  const disagreement = subject.findings.find((finding) => finding.field === field && finding.kind === "register-disagrees");
  if (!disagreement) {
    return null;
  }
  return {
    value: disagreement.value,
    sources: { ...subject.sources, [field]: "register" },
    manualFields: subject.manualFields.filter((kept) => kept !== field),
    findings: subject.findings.filter((finding) => !(finding.field === field && finding.kind === "register-disagrees")),
  };
}

/**
 * Her correction of one field: the value is hers from now on, marked `manual`,
 * and any register disagreement about that field is resolved.
 */
export function correctSubjectField(
  subject: SubjectState,
  field: SubjectField,
  value: string | null,
  now: string,
): SubjectUpdate {
  if (!MANUAL_SUBJECT_FIELDS.includes(field)) {
    throw new Error(`Pole ${field} sa nedá upraviť ručne.`);
  }
  if (field === "vatGroupId") {
    throw new Error("Členstvo v skupine DPH sa upravuje cez correctVatGroup.");
  }
  const trimmed = value?.trim() || null;
  const manualFields = subject.manualFields.includes(field)
    ? subject.manualFields
    : [...subject.manualFields, field];
  return {
    [field]: trimmed,
    sources: { ...subject.sources, [field]: "manual" },
    manualFields,
    findings: subject.findings.filter((finding) => !(finding.field === field && finding.kind === "register-disagrees")),
    verifiedAt: subject.verifiedAt ?? now,
  } as SubjectUpdate;
}

/**
 * The VAT group a subject is recorded as a member of (ADR 0022, PRD 0004 story
 * 33). Stored as the normalised group VAT ID; a value that is not a VAT ID is refused.
 */
export function groupVatIdOf(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/\s+/g, "").toUpperCase();
  if (normalized.length === 0) {
    return null;
  }
  if (!/^[A-Z]{2}[0-9A-Z]{2,12}$/.test(normalized)) {
    throw new Error("IČ DPH skupiny nemá platný tvar.");
  }
  return normalized;
}

/**
 * Her correction of the VAT group (manual provenance): the subject is recorded as a
 * member of `groupVatId`, or as a member of none when null.
 */
export function correctVatGroup(subject: SubjectState, groupVatId: string | null): SubjectVatUpdate {
  const manualFields = subject.manualFields.includes("vatGroupId")
    ? subject.manualFields
    : [...subject.manualFields, "vatGroupId" as const];
  return {
    vatGroupId: groupVatIdOf(groupVatId),
    sources: { ...subject.sources, vatGroupId: "manual" },
    manualFields,
  };
}

/**
 * A membership a confirmed document shows (its IČO with the group IČ DPH VIES reports
 * as "Group registration"). Recorded with the `vies` provenance: it is evidence, not her correction.
 */
export function recordVatGroupFromVies(subject: SubjectState, groupVatId: string): SubjectVatUpdate {
  return {
    vatGroupId: groupVatIdOf(groupVatId),
    sources: { ...subject.sources, vatGroupId: "vies" },
  };
}

/**
 * The VAT ID VIES is asked about for a party: its IČ DPH (a Czech party's DIČ, which is
 * its VAT ID), or a foreign party's VAT ID. Null when there is none that VIES can answer:
 * a malformed one is a mismatch offline already, and a non-EU VAT ID is not VIES's to say.
 */
export function viesTargetOf(party: PartyIdentity, country: SubjectCountry | null): string | null {
  const vatId = vatIdOf(party, country);
  if (!vatId) {
    return null;
  }
  const prefix = vatId.slice(0, 2);
  if (!VIES_PREFIXES.has(prefix)) {
    return null;
  }
  if (prefix === "SK") {
    return /^SK\d{10}$/.test(vatId) && Number(vatId.slice(2)) % 11 === 0 ? vatId : null;
  }
  if (prefix === "CZ") {
    return /^CZ\d{8,10}$/.test(vatId) ? vatId : null;
  }
  return /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(vatId) ? vatId : null;
}

/**
 * The subject's own IČ DPH, when VIES confirms the VAT ID belongs to it: valid,
 * not a VAT group's number, and held by the name the register gives the subject.
 * Null otherwise, and when she has corrected the field herself.
 */
export function icDphConfirmedByVies(
  subject: SubjectState,
  vatId: string,
  answer: ViesAnswer | Unavailable | null | undefined,
): SubjectIcDphUpdate | null {
  if (!answer || !("valid" in answer) || !answer.valid || answer.lapsed) {
    return null;
  }
  if (isGroupRegistrationHolder(answer.holderName)) {
    return null;
  }
  const holder = comparableHolderName(answer.holderName);
  if (holder === null || !subject.legalName) {
    return null;
  }
  if (coreCompanyName(holder) !== coreCompanyName(subject.legalName)) {
    return null;
  }
  const current = compact(subject.icDph).toUpperCase();
  if (subject.manualFields.includes("icDph")) {
    // Her own number is kept, unless it is the one VIES confirms: then it is confirmed, and no longer hers alone.
    if (current !== vatId) {
      return null;
    }
    return {
      icDph: vatId,
      sources: { ...subject.sources, icDph: "vies" },
      manualFields: subject.manualFields.filter((field) => field !== "icDph"),
    };
  }
  if (current === vatId) {
    return null;
  }
  return { icDph: vatId, sources: { ...subject.sources, icDph: "vies" } };
}

/**
 * The VIES record after a check. A number VIES no longer knows is lapsed when it was
 * valid before (and then it stays lapsed until VIES confirms it again); a number that was
 * never valid is simply invalid.
 */
export function nextViesRecord(
  previous: ViesRecord | undefined,
  check: { valid: boolean; name: string | null },
  now: string,
): ViesRecord {
  if (check.valid) {
    return { valid: true, holderName: check.name, checkedAt: now, lapsedAt: null };
  }
  const lapsedAt = previous?.valid ? now : (previous?.lapsedAt ?? null);
  return { valid: false, holderName: null, checkedAt: now, lapsedAt };
}

/** What the integrity checks read from a stored VIES record. */
export function viesAnswerOf(record: ViesRecord): ViesAnswer {
  return {
    valid: record.valid,
    holderName: record.holderName,
    ...(record.lapsedAt !== null ? { lapsed: true } : {}),
  };
}
