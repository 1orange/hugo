/**
 * Identity her client brings to role derivation (ADR 0018). Registers fill
 * everything except IČ DPH — VAT groups break SK + DIČ.
 */

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
