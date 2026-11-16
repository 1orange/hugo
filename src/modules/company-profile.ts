/**
 * Identity her client brings to role derivation (ADR 0018). Registers fill
 * everything except IČ DPH — VAT groups break SK + DIČ.
 */

import type { SubjectSource } from "./subject-directory";

export type CompanyCountry = "SK" | "CZ";

export type HomeCurrency = "EUR" | "CZK";

export function homeCurrencyForCountry(country: CompanyCountry): HomeCurrency {
  return country === "CZ" ? "CZK" : "EUR";
}

export function countrySetupLabel(country: CompanyCountry): string {
  return country === "CZ" ? "Česká republika" : "Slovensko";
}

export function registerSearchHeading(country: CompanyCountry): string {
  return country === "CZ" ? "Vyhľadať v ARES" : "Vyhľadať v RPO";
}

export function registerDirectLookupLabel(country: CompanyCountry): string {
  return country === "CZ" ? "Načítať z ARES" : "Načítať z RÚZ";
}

export type CompanyProfileFields = {
  country: CompanyCountry;
  legalName: string;
  address: string;
  ico: string;
  dic: string;
  icDph: string;
  registerSource: string;
  savedAt: string;
};

/**
 * The identity fields of a client's profile that its subject holds (the IČO is the
 * subject's key, and the country too). Only these carry provenance.
 */
export const PROFILE_FIELDS = ["legalName", "address", "dic", "icDph"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export function isProfileField(value: unknown): value is ProfileField {
  return typeof value === "string" && (PROFILE_FIELDS as readonly string[]).includes(value);
}

/** The profile's identity as typed or looked up: trimmed, and "" where empty. */
export type ProfileValues = Record<ProfileField, string>;

/**
 * Where a value a register lookup filled came from (ADR 0022): a register answer is
 * `register`, and the IČ DPH is `vies` when VIES confirmed it. Null for anything else,
 * which is then her own typing.
 */
export function lookupSourceOf(registerSource: string, field: ProfileField): SubjectSource | null {
  const source = registerSource.trim();
  if (!/^(rpo|ruz|ares)/.test(source)) {
    return null;
  }
  if (field === "icDph") {
    return source.endsWith("+vies") ? "vies" : null;
  }
  return "register";
}

export type ProfileProvenance = {
  /** The source of each non-empty identity field; an empty field has none. */
  sources: Partial<Record<ProfileField, SubjectSource>>;
  /** The identity fields whose value changed in this save. */
  changed: ProfileField[];
};

/**
 * Where each identity value of a profile save came from (ADR 0022, amended 2026-11-16).
 * A value that is the same as the subject's holds its source: saving the form again
 * does not re-label what she never touched. A changed value is hers (`manual`) when she
 * typed it, and otherwise the register's (or VIES's) when the lookup gave it, and
 * `manual` when nothing else says so.
 */
export function profileProvenance(input: {
  previous: { values: ProfileValues; sources: Partial<Record<string, SubjectSource>> } | null;
  next: ProfileValues;
  registerSource: string;
  typed: readonly ProfileField[];
}): ProfileProvenance {
  const sources: ProfileProvenance["sources"] = {};
  const changed: ProfileField[] = [];
  for (const field of PROFILE_FIELDS) {
    const value = input.next[field];
    if (value === "") {
      continue;
    }
    const before = input.previous?.sources[field];
    if (input.previous && input.previous.values[field] === value && before) {
      sources[field] = before;
      continue;
    }
    changed.push(field);
    sources[field] = input.typed.includes(field)
      ? "manual"
      : (lookupSourceOf(input.registerSource, field) ?? "manual");
  }
  return { sources, changed };
}

export type RegisterEntityStatus = "active" | "dissolved";

export type RegisterSearchHit = {
  ico: string;
  legalName: string;
  address: string;
  status: RegisterEntityStatus;
};

export type RegisterLookup = {
  country: CompanyCountry;
  legalName: string;
  address: string;
  ico: string;
  dic: string;
  /** Names the entity held before (RPO's history). Absent where the register does not say. */
  formerNames?: string[];
  /** Absent where the register does not say; an entity it lists is taken as active. */
  status?: RegisterEntityStatus;
};

const SK_IC_DPH = /^SK\d{10}$/;

export function validateSkIcDph(value: string): { ok: true } | { ok: false; message: string } {
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length === 0) {
    return { ok: false, message: "IČ DPH je povinné." };
  }
  if (!SK_IC_DPH.test(trimmed)) {
    return {
      ok: false,
      message: "IČ DPH musí mať tvar SK a desať číslic (napr. SK1234567890).",
    };
  }
  return { ok: true };
}

export function normalizeSkIcDph(value: string): string {
  return value.trim().toUpperCase();
}

export function registerStatusLabel(status: RegisterEntityStatus): string {
  return status === "active" ? "Aktívna" : "Zaniknutá";
}

export function profileMissingLabel(): string {
  return "Chýba profil";
}

export function profileSetupActionLabel(): string {
  return "Nastaviť profil firmy";
}
