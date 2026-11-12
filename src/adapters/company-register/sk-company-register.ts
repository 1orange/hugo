import type { CompanyRegister, RegisterLookupOptions } from "@/adapters/company-register/port";
import { lookupRuzByIco } from "@/adapters/company-register/ruz-client";
import { searchRpoByName, searchRpoHistoryByName } from "@/adapters/company-register/rpo-client";
import type { CompanyCountry, RegisterLookup, RegisterSearchHit } from "@/modules/company-profile";

export class SkCompanyRegister implements CompanyRegister {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async searchByName(name: string, country: CompanyCountry): Promise<RegisterSearchHit[]> {
    if (country !== "SK") {
      return [];
    }
    return searchRpoByName(name, this.fetchImpl);
  }

  /**
   * RÚZ gives the current name, DIČ and address. With `withHistory` the name's
   * history comes from RPO too (former names, and whether it has ceased) — a
   * second, slower request, so setup does not ask for it.
   */
  async lookupByIco(
    ico: string,
    country: CompanyCountry,
    options: RegisterLookupOptions = {},
  ): Promise<RegisterLookup | null> {
    if (country !== "SK") {
      return null;
    }
    const lookup = await lookupRuzByIco(ico, this.fetchImpl);
    if (!lookup || !options.withHistory) {
      return lookup;
    }
    // A failing history leaves the lookup as RÚZ gave it: the names are then unknown, not none.
    const history = await searchRpoHistoryByName(lookup.legalName, this.fetchImpl).catch(() => null);
    const entity = history?.find((hit) => hit.ico === lookup.ico);
    if (!entity) {
      return lookup;
    }
    return { ...lookup, formerNames: entity.formerNames, status: entity.status };
  }
}
