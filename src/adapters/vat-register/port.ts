/** What the EU's VAT register says of one VAT ID. */
export type VatNumberCheck =
  | { valid: true; /** As registered; null when the member state does not say. */ name: string | null }
  | { valid: false };

export interface VatRegister {
  /** `vatId` with its country prefix, "SK2023141351". Throws when the register cannot answer. */
  check(vatId: string): Promise<VatNumberCheck>;
}
