import type { VatNumberCheck, VatRegister } from "./port";

/** Knows only the VAT IDs it is given, by name; every other one is not registered. */
export class FakeVatRegister implements VatRegister {
  constructor(private readonly registered: Record<string, string> = {}) {}

  async check(vatId: string): Promise<VatNumberCheck> {
    const name = this.registered[vatId.trim().toUpperCase()];
    return name === undefined ? { valid: false } : { valid: true, name };
  }
}
