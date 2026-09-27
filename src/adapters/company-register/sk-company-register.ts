import type { CompanyRegister } from "@/adapters/company-register/port";
import { lookupRuzByIco } from "@/adapters/company-register/ruz-client";
import { searchRpoByName } from "@/adapters/company-register/rpo-client";
import type { CompanyCountry, RegisterLookup, RegisterSearchHit } from "@/modules/company-profile";

export class SkCompanyRegister implements CompanyRegister {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async searchByName(name: string, country: CompanyCountry): Promise<RegisterSearchHit[]> {
    if (country !== "SK") {
      return [];
    }
    return searchRpoByName(name, this.fetchImpl);
  }

  async lookupByIco(ico: string, country: CompanyCountry): Promise<RegisterLookup | null> {
    if (country !== "SK") {
      return null;
    }
    return lookupRuzByIco(ico, this.fetchImpl);
  }
}
