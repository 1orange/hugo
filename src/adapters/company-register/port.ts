import type {
  CompanyCountry,
  RegisterLookup,
  RegisterSearchHit,
} from "@/modules/company-profile";

export type { RegisterLookup, RegisterSearchHit };

export type RegisterLookupOptions = {
  /** Also ask for the name's history: former names and whether the entity has ceased. Slower. */
  withHistory?: boolean;
};

export interface CompanyRegister {
  searchByName(name: string, country: CompanyCountry): Promise<RegisterSearchHit[]>;
  lookupByIco(
    ico: string,
    country: CompanyCountry,
    options?: RegisterLookupOptions,
  ): Promise<RegisterLookup | null>;
}
