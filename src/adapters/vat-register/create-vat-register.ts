import { FakeVatRegister } from "./fake-vat-register";
import type { VatRegister } from "./port";
import { ViesVatRegister } from "./vies-client";

export function createVatRegister(env: NodeJS.ProcessEnv = process.env): VatRegister {
  // With the company registers faked (e2e), VIES is too: it confirms nothing.
  if (env.COMPANY_REGISTER === "fake" || env.DRIVE_CLIENT === "fake") {
    return new FakeVatRegister();
  }
  return new ViesVatRegister();
}
