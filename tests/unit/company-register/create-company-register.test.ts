import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { createCompanyRegister } from "../../../src/adapters/company-register/create-company-register.ts";

test("createCompanyRegister uses fake when DRIVE_CLIENT is fake", () => {
  const register = createCompanyRegister({
    DRIVE_CLIENT: "fake",
    NODE_ENV: "development",
  } as NodeJS.ProcessEnv);
  assert.ok(register instanceof FakeCompanyRegister);
});
