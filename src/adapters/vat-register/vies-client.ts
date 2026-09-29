import type { VatNumberCheck, VatRegister } from "./port";

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";
const VIES_TIMEOUT_MS = 8000;

type ViesResponse = {
  isValid?: boolean;
  /** "VALID", "INVALID", or why no answer came: "MS_UNAVAILABLE", "TIMEOUT", … */
  userError?: string;
  name?: string;
};

/**
 * VIES, the EU's check of a VAT ID against its member state's register. No
 * key. It answers 200 even when the member state is down, saying so in
 * `userError`; only "INVALID" means the number is not registered.
 */
export async function checkViesVatNumber(
  vatId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VatNumberCheck> {
  const match = /^([A-Z]{2})([0-9A-Z]+)$/.exec(vatId.replace(/\s/g, "").toUpperCase());
  if (!match) {
    return { valid: false };
  }
  const [, country, number] = match;
  const response = await fetchImpl(`${VIES_URL}/${country}/vat/${number}`, {
    headers: { Accept: "application/json", "User-Agent": "hugo-accounting/1.0" },
    signal: AbortSignal.timeout(VIES_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`VIES HTTP ${response.status}`);
  }
  const body = (await response.json()) as ViesResponse;
  if (body.isValid === true) {
    const name = body.name?.trim();
    return { valid: true, name: name && name !== "---" ? name : null };
  }
  if (body.userError === "INVALID") {
    return { valid: false };
  }
  throw new Error(`VIES: ${body.userError ?? "no answer"}`);
}

export class ViesVatRegister implements VatRegister {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  check(vatId: string): Promise<VatNumberCheck> {
    return checkViesVatNumber(vatId, this.fetchImpl);
  }
}
