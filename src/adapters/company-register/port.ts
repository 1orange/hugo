import type {
  CompanyCountry,
  RegisterLookup,
  RegisterSearchHit,
} from "@/modules/company-profile";

export type { RegisterLookup, RegisterSearchHit };

export interface CompanyRegister {
  searchByName(name: string, country: CompanyCountry): Promise<RegisterSearchHit[]>;
  lookupByIco(ico: string, country: CompanyCountry): Promise<RegisterLookup | null>;
}
