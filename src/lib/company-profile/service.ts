import { createCompanyRegister } from "@/adapters/company-register/create-company-register";
import type { CompanyRegister } from "@/adapters/company-register/port";
import { getCompanyById } from "@/adapters/store/companies";
import {
  getCompanyProfile,
  saveCompanyProfile,
  type CompanyProfileRow,
} from "@/adapters/store/company-profiles";
import { appendUserEvent } from "@/adapters/store/events";
import type {
  CompanyCountry,
  RegisterLookup,
  RegisterSearchHit,
} from "@/modules/company-profile";
import {
  normalizeSkIcDph,
  validateSkIcDph,
} from "@/modules/company-profile";

export type ProfileSaveInput = {
  country: CompanyCountry;
  legalName: string;
  address: string;
  ico: string;
  dic: string;
  icDph: string;
  registerSource: string;
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

export async function searchCompanyRegister(
  companyId: number,
  query: string,
  country: CompanyCountry,
  deps?: { register?: CompanyRegister },
): Promise<
  | { ok: true; hits: RegisterSearchHit[]; folderName: string }
  | { ok: false; message: string }
> {
  const company = getCompanyById(companyId);
  if (!company) {
    return { ok: false, message: "Firma sa nenašla." };
  }
  const hits = await register(deps).searchByName(query.trim() || company.name, country);
  return { ok: true, hits, folderName: company.name };
}

export async function lookupCompanyRegister(
  ico: string,
  country: CompanyCountry,
  deps?: { register?: CompanyRegister },
): Promise<
  | { ok: true; lookup: RegisterLookup; registerSource: string }
  | { ok: false; message: string }
> {
  const trimmed = ico.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Zadaj IČO." };
  }
  const lookup = await register(deps).lookupByIco(trimmed, country);
  if (!lookup) {
    return { ok: false, message: lookupNotFoundMessage(country) };
  }
  return { ok: true, lookup, registerSource: registerSourceForLookup(country) };
}

export function loadCompanyProfileView(companyId: number): {
  companyName: string;
  profile: CompanyProfileRow | null;
} | null {
  const company = getCompanyById(companyId);
  if (!company) {
    return null;
  }
  return {
    companyName: company.name,
    profile: getCompanyProfile(companyId),
  };
}

export function saveCompanyProfileForUser(
  companyId: number,
  input: ProfileSaveInput,
  timestamp: string,
): { ok: true; profile: CompanyProfileRow } | { ok: false; message: string } {
  const company = getCompanyById(companyId);
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
  if (country === "SK" && !dic) {
    return { ok: false, message: "Právny názov, IČO a DIČ sú povinné." };
  }

  let icDph = "";
  if (country === "SK") {
    const icDphCheck = validateSkIcDph(input.icDph);
    if (!icDphCheck.ok) {
      return icDphCheck;
    }
    icDph = normalizeSkIcDph(input.icDph);
  }

  const profile = saveCompanyProfile(companyId, {
    country,
    legalName,
    address,
    ico,
    dic,
    icDph,
    registerSource: input.registerSource.trim() || "manual",
    savedAt: timestamp,
  });

  appendUserEvent(timestamp, companyId, "CompanyProfileSaved", {
    country: profile.country,
    legalName: profile.legalName,
    ico: profile.ico,
    registerSource: profile.registerSource,
  });

  return { ok: true, profile };
}
