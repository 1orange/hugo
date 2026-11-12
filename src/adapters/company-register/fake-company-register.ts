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

export type FakeCompanyRegisterOptions = {
  /** The entities the fake knows by IČO and country. Default: the e2e fixture. */
  lookups?: RegisterLookup[];
  /** Milliseconds each lookup takes, so that concurrent callers overlap. */
  delayMs?: number;
};

/**
 * A register that answers from fixtures and counts what it was asked: a test
 * asserts how often the directory called it, and that a page never did.
 */
export class FakeCompanyRegister implements CompanyRegister {
  /** Every IČO looked up, in order, with its country. */
  readonly lookupCalls: Array<{ ico: string; country: CompanyCountry }> = [];
  /** Set to make every lookup fail, as a register outage would. */
  failure: Error | null = null;

  constructor(private readonly options: FakeCompanyRegisterOptions = {}) {}

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
    this.lookupCalls.push({ ico: ico.trim(), country });
    if (this.options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    if (this.failure) {
      throw this.failure;
    }
    const entities = this.options.lookups ?? Object.values(E2E_LOOKUP);
    return entities.find((lookup) => lookup.ico === ico.trim() && lookup.country === country) ?? null;
  }
}
