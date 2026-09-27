import { CzCompanyRegister } from "@/adapters/company-register/cz-company-register";
import { FakeCompanyRegister } from "@/adapters/company-register/fake-company-register";
import type { CompanyRegister } from "@/adapters/company-register/port";
import { RoutingCompanyRegister } from "@/adapters/company-register/routing-company-register";
import { SkCompanyRegister } from "@/adapters/company-register/sk-company-register";

export function createCompanyRegister(
  env: NodeJS.ProcessEnv = process.env,
): CompanyRegister {
  // E2E always runs with DRIVE_CLIENT=fake; keep registers on the same fixture.
  if (env.COMPANY_REGISTER === "fake" || env.DRIVE_CLIENT === "fake") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "COMPANY_REGISTER=fake must never be used in production: it replaces real register data with fixture data",
      );
    }
    return new FakeCompanyRegister();
  }

  return new RoutingCompanyRegister({
    SK: new SkCompanyRegister(),
    CZ: new CzCompanyRegister(),
  });
}
