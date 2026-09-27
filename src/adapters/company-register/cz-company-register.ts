import type { CompanyRegister } from "@/adapters/company-register/port";
import { lookupAresByIco, searchAresByName } from "@/adapters/company-register/ares-client";
import type { CompanyCountry, RegisterLookup, RegisterSearchHit } from "@/modules/company-profile";

export class CzCompanyRegister implements CompanyRegister {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async searchByName(name: string, country: CompanyCountry): Promise<RegisterSearchHit[]> {
    if (country !== "CZ") {
      return [];
    }
    return searchAresByName(name, this.fetchImpl);
  }

  async lookupByIco(ico: string, country: CompanyCountry): Promise<RegisterLookup | null> {
    if (country !== "CZ") {
      return null;
    }
    return lookupAresByIco(ico, this.fetchImpl);
  }
}
