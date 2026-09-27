import type { CompanyRegister } from "@/adapters/company-register/port";
import type {
  CompanyCountry,
  RegisterLookup,
  RegisterSearchHit,
} from "@/modules/company-profile";

const E2E_CANDIDATES: RegisterSearchHit[] = [
  {
    ico: "31333532",
    legalName: "Beta s.r.o.",
    address: "Bratislava, Pribinova 25",
    status: "active",
  },
  {
    ico: "35757442",
    legalName: "Beta Group s.r.o.",
    address: "Košice, Hlavná 12",
    status: "active",
  },
  {
    ico: "12345678",
    legalName: "Beta Services, a. s.",
    address: "Žilina, Námestie 1",
    status: "dissolved",
  },
];

const E2E_CZ_CANDIDATES: RegisterSearchHit[] = [
  {
    ico: "87654321",
    legalName: "Gamma s.r.o.",
    address: "Praha, Václavské náměstí 1",
    status: "active",
  },
  {
    ico: "87654322",
    legalName: "Gamma Logistics s.r.o.",
    address: "Brno, Masarykova 5",
    status: "active",
  },
];

const E2E_LOOKUP: Record<string, RegisterLookup> = {
  "31333532": {
    country: "SK",
    ico: "31333532",
    legalName: "Beta s.r.o.",
    address: "Bratislava, Pribinova 25",
    dic: "2020311335",
  },
  "35757442": {
    country: "SK",
    ico: "35757442",
    legalName: "Beta Group s.r.o.",
    address: "Košice, Hlavná 12",
    dic: "2020357574",
  },
  "87654321": {
    country: "CZ",
    ico: "87654321",
    legalName: "Gamma s.r.o.",
    address: "Praha, Václavské náměstí 1",
    dic: "CZ87654321",
  },
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export class FakeCompanyRegister implements CompanyRegister {
  async searchByName(name: string, country: CompanyCountry): Promise<RegisterSearchHit[]> {
    const needle = normalizeName(name);
    if (needle.length === 0) {
      return [];
    }
    if (country === "CZ") {
      return E2E_CZ_CANDIDATES.filter(
        (hit) =>
          normalizeName(hit.legalName).includes(needle) || needle.includes("gamma"),
      );
    }
    if (country === "SK") {
      return E2E_CANDIDATES.filter(
        (hit) =>
          normalizeName(hit.legalName).includes(needle) || needle.includes("beta"),
      );
    }
    return [];
  }

  async lookupByIco(ico: string, country: CompanyCountry): Promise<RegisterLookup | null> {
    const lookup = E2E_LOOKUP[ico.trim()];
    if (!lookup || lookup.country !== country) {
      return null;
    }
    return lookup;
  }
}
