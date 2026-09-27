import type { EkasaLookup, EkasaLookupResult } from "./port";

export class FakeEkasaLookup implements EkasaLookup {
  readonly calls: string[] = [];
  private readonly responses: Map<string, EkasaLookupResult>;
  private readonly defaultResult: EkasaLookupResult;

  constructor(options?: {
    responses?: Record<string, EkasaLookupResult>;
    defaultResult?: EkasaLookupResult;
  }) {
    this.responses = new Map(Object.entries(options?.responses ?? {}));
    this.defaultResult = options?.defaultResult ?? {
      ok: false,
      reason: "Receipt not found (fake lookup).",
    };
  }

  async findReceipt(receiptId: string): Promise<EkasaLookupResult> {
    this.calls.push(receiptId);
    return this.responses.get(receiptId) ?? this.defaultResult;
  }
}

/** Always fails — discovery falls back to the text-layer parser. */
export function failingEkasaLookup(reason = "Lookup unavailable (test)."): EkasaLookup {
  return new FakeEkasaLookup({ defaultResult: { ok: false, reason } });
}
