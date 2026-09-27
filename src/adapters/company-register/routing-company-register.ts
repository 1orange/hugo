import type { CompanyRegister } from "@/adapters/company-register/port";
import type { CompanyCountry, RegisterLookup, RegisterSearchHit } from "@/modules/company-profile";

export class RoutingCompanyRegister implements CompanyRegister {
  constructor(
    private readonly byCountry: Record<CompanyCountry, CompanyRegister>,
  ) {}

  searchByName(name: string, country: CompanyCountry): Promise<RegisterSearchHit[]> {
    return this.byCountry[country].searchByName(name, country);
  }

  lookupByIco(ico: string, country: CompanyCountry): Promise<RegisterLookup | null> {
    return this.byCountry[country].lookupByIco(ico, country);
  }
}
