import type { VatNumberCheck, VatRegister } from "./port";

/**
 * Knows only the VAT IDs it is given, by name (null: valid, with no name to
 * give, as VIES answers for some member states); every other one is not
 * registered. It counts what it was asked, as the tests assert how often VIES
 * was called.
 */
export class FakeVatRegister implements VatRegister {
  /** Every VAT ID asked, normalised, in order. */
  readonly checks: string[] = [];
  /** Set to make every check fail, as a VIES outage would. */
  failure: Error | null = null;
  /** Milliseconds each check takes, so that concurrent callers overlap. */
  delayMs = 0;

  /**
   * What an unknown VAT ID gets: "invalid" (not registered, the tests'
   * default) or "unavailable" (the check throws, as an outage would) — the
   * e2e app's choice, so every counterparty is not flagged as unregistered.
   */
  constructor(
    private readonly registered: Record<string, string | null> = {},
    private readonly unknown: "invalid" | "unavailable" = "invalid",
  ) {}

  async check(vatId: string): Promise<VatNumberCheck> {
    const key = vatId.trim().toUpperCase();
    this.checks.push(key);
    if (this.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failure) {
      throw this.failure;
    }
    const name = this.registered[key];
    if (name === undefined && this.unknown === "unavailable") {
      throw new Error("Fake VIES knows nothing about " + key);
    }
    return name === undefined ? { valid: false } : { valid: true, name };
  }
}
