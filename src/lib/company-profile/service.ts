import { createCompanyRegister } from "@/adapters/company-register/create-company-register";
import type { CompanyRegister } from "@/adapters/company-register/port";
import { createVatRegister } from "@/adapters/vat-register/create-vat-register";
import type { VatRegister } from "@/adapters/vat-register/port";
import { getCompanyById } from "@/adapters/store/companies";
import {
  getCompanyProfile,
  ProfileIcoTakenError,
  saveCompanyProfile,
  type CompanyProfileRow,
} from "@/adapters/store/company-profiles";
import { appendUserEvent } from "@/adapters/store/events";
import { scheduleClientSubjectCheck } from "@/lib/subject-directory/schedule";
import type {
  CompanyCountry,
  RegisterLookup,
  RegisterSearchHit,
} from "@/modules/company-profile";
import {
  isProfileField,
  normalizeSkIcDph,
  validateSkIcDph,
} from "@/modules/company-profile";
import { companyDisplayName } from "@/modules/company-display-name";
import { coreCompanyName, normalizeCompanyName, rankRegisterHits } from "@/modules/register-search";

export type ProfileSaveInput = {
  country: CompanyCountry;
  legalName: string;
  address: string;
  ico: string;
  dic: string;
  icDph: string;
  registerSource: string;
  /** The identity fields she typed by hand, as opposed to those a lookup filled. */
  typedFields?: readonly string[];
};

function register(deps?: { register?: CompanyRegister }): CompanyRegister {
  return deps?.register ?? createCompanyRegister();
}

function lookupNotFoundMessage(country: CompanyCountry): string {
  if (country === "CZ") {
    return "Pre toto IČO sa v ARES nenašiel subjekt.";
  }
  return "Pre toto IČO sa v RÚZ nenašla účtovná jednotka.";
}

function registerSourceForLookup(country: CompanyCountry): string {
  return country === "CZ" ? "ares" : "rpo+ruz";
}

function registerUnavailableMessage(
  country: CompanyCountry,
  action: "search" | "lookup",
  error: unknown,
): string {
  const name = country === "CZ" ? "ARES" : action === "search" ? "RPO" : "RÚZ";
  const detail = error instanceof Error ? error.message : String(error);
  return `Register ${name} teraz neodpovedá (${detail}). Skús to o chvíľu znova alebo vyplň údaje ručne.`;
}

/** Candidates shown for one query; the rest are reached by a longer query. */
export const REGISTER_SEARCH_LIMIT = 20;

/**
 * RPO takes 6–7 s for a name, and the search runs as she types: a query
 * already asked is answered from here for ten minutes.
 */
const SEARCH_CACHE_TTL_MS = 10 * 60_000;
const SEARCH_CACHE_MAX = 200;
const searchCache = new Map<string, { at: number; hits: RegisterSearchHit[] }>();

async function searchRegisterCached(
  registerImpl: CompanyRegister,
  query: string,
  country: CompanyCountry,
  cached: boolean,
): Promise<RegisterSearchHit[]> {
  const key = `${country}:${normalizeCompanyName(query)}`;
  const hit = cached ? searchCache.get(key) : undefined;
  if (hit && Date.now() - hit.at < SEARCH_CACHE_TTL_MS) {
    return hit.hits;
  }
  const hits = await registerImpl.searchByName(query, country);
  if (cached) {
    searchCache.delete(key);
    searchCache.set(key, { at: Date.now(), hits });
    if (searchCache.size > SEARCH_CACHE_MAX) {
      searchCache.delete(searchCache.keys().next().value!);
    }
  }
  return hits;
}

export async function searchCompanyRegister(
  companyId: number,
  query: string,
  country: CompanyCountry,
  deps?: { register?: CompanyRegister },
): Promise<
  | { ok: true; hits: RegisterSearchHit[]; total: number; companyName: string }
  | { ok: false; message: string }
> {
  const company = await getCompanyById(companyId);
  if (!company) {
    return { ok: false, message: "Firma sa nenašla." };
  }
  // The folder name without its "Doklady " (or older "Konto ") prefix (ADR 0007, ADR 0018).
  const effectiveQuery = query.trim() || companyDisplayName(company.name);
  let hits: RegisterSearchHit[];
  try {
    // An injected register is a test's; its answers are not kept.
    hits = await searchRegisterCached(register(deps), effectiveQuery, country, !deps?.register);
  } catch (error) {
    return { ok: false, message: registerUnavailableMessage(country, "search", error) };
  }
  const ranked = rankRegisterHits(effectiveQuery, hits);
  return {
    ok: true,
    hits: ranked.slice(0, REGISTER_SEARCH_LIMIT),
    total: ranked.length,
    companyName: companyDisplayName(company.name),
  };
}

/**
 * A Slovak company's IČ DPH, when VIES vouches for it. Neither Slovak register
 * carries IČ DPH, and "SK" + DIČ is wrong exactly for a VAT group member —
 * Slovnaft's SK2020372640 is not registered, its group's SK7120001713 is — so
 * the guess is only kept when VIES says it is registered, and to this name.
 */
async function confirmSkIcDph(
  lookup: RegisterLookup,
  vatRegister: VatRegister,
): Promise<{ icDph: string | null; note: string }> {
  const dic = lookup.dic.replace(/\s/g, "");
  if (!/^\d{10}$/.test(dic)) {
    return { icDph: null, note: "IČ DPH zadaj ručne." };
  }
  const candidate = `SK${dic}`;
  let check;
  try {
    check = await vatRegister.check(candidate);
  } catch {
    return { icDph: null, note: "VIES teraz neodpovedá — IČ DPH zadaj ručne." };
  }
  if (!check.valid) {
    return {
      icDph: null,
      note: `${candidate} nie je vo VIES platné — firma nie je platiteľ DPH, alebo je v skupine DPH s vlastným číslom. IČ DPH zadaj z dokladov.`,
    };
  }
  if (!check.name || coreCompanyName(check.name) !== coreCompanyName(lookup.legalName)) {
    return {
      icDph: null,
      note: `VIES vedie ${candidate} pod iným názvom (${check.name ?? "bez názvu"}). Over IČ DPH na dokladoch a zadaj ho ručne.`,
    };
  }
  return { icDph: candidate, note: `IČ DPH ${candidate} overené vo VIES.` };
}

export async function lookupCompanyRegister(
  ico: string,
  country: CompanyCountry,
  deps?: { register?: CompanyRegister; vatRegister?: VatRegister },
): Promise<
  | {
      ok: true;
      lookup: RegisterLookup;
      registerSource: string;
      /** SK only: SK + DIČ when VIES confirms it (ADR 0018 amendment). */
      icDph: string | null;
      icDphNote: string | null;
    }
  | { ok: false; message: string }
> {
  const trimmed = ico.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Zadaj IČO." };
  }
  let lookup: RegisterLookup | null;
  try {
    lookup = await register(deps).lookupByIco(trimmed, country);
  } catch (error) {
    return { ok: false, message: registerUnavailableMessage(country, "lookup", error) };
  }
  if (!lookup) {
    return { ok: false, message: lookupNotFoundMessage(country) };
  }
  if (country === "CZ") {
    // The Czech DIČ from ARES is the VAT ID itself.
    return { ok: true, lookup, registerSource: registerSourceForLookup(country), icDph: null, icDphNote: null };
  }
  const { icDph, note } = await confirmSkIcDph(lookup, deps?.vatRegister ?? createVatRegister());
  return {
    ok: true,
    lookup,
    registerSource: icDph ? `${registerSourceForLookup(country)}+vies` : registerSourceForLookup(country),
    icDph,
    icDphNote: note,
  };
}

export async function loadCompanyProfileView(companyId: number): Promise<{
  companyName: string;
  profile: CompanyProfileRow | null;
} | null> {
  const company = await getCompanyById(companyId);
  if (!company) {
    return null;
  }
  return {
    companyName: companyDisplayName(company.name),
    profile: await getCompanyProfile(companyId),
  };
}

export async function saveCompanyProfileForUser(
  companyId: number,
  input: ProfileSaveInput,
  timestamp: string,
): Promise<{ ok: true; profile: CompanyProfileRow } | { ok: false; message: string }> {
  const company = await getCompanyById(companyId);
  if (!company) {
    return { ok: false, message: "Firma sa nenašla." };
  }

  const country = input.country;
  if (country !== "SK" && country !== "CZ") {
    return { ok: false, message: "Neplatná krajina profilu." };
  }

  const legalName = input.legalName.trim();
  const address = input.address.trim();
  const ico = input.ico.trim();
  const dic = input.dic.trim();
  if (!legalName || !ico) {
    return { ok: false, message: "Právny názov a IČO sú povinné." };
  }

  // Not every company has a DIČ or is a VAT payer (RPO lists such firms too):
  // both are optional, but an IČ DPH she enters must be well formed.
  let icDph = "";
  if (country === "SK" && input.icDph.trim()) {
    const icDphCheck = validateSkIcDph(input.icDph);
    if (!icDphCheck.ok) {
      return icDphCheck;
    }
    icDph = normalizeSkIcDph(input.icDph);
  }

  const typed = (input.typedFields ?? []).filter(isProfileField);
  let profile: CompanyProfileRow;
  try {
    // The profile is the client's subject in the Adresár (ADR 0022, amended 2026-11-16): one record.
    profile = await saveCompanyProfile(
      companyId,
      {
        country,
        legalName,
        address,
        ico,
        dic,
        icDph,
        registerSource: input.registerSource.trim() || "manual",
        savedAt: timestamp,
      },
      typed,
    );
  } catch (error) {
    if (error instanceof ProfileIcoTakenError) {
      return { ok: false, message: "Toto IČO už má v Hugu profil inej firmy." };
    }
    throw error;
  }

  await appendUserEvent(timestamp, companyId, "CompanyProfileSaved", {
    country: profile.country,
    legalName: profile.legalName,
    ico: profile.ico,
    registerSource: profile.registerSource,
  });
  // What the subject holds has just changed: the register and VIES are asked about it (0006/03).
  await scheduleClientSubjectCheck(companyId);

  return { ok: true, profile };
}
