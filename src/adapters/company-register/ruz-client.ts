import type { RegisterLookup } from "@/modules/company-profile";

const RUZ_BASE = "https://registeruz.sk/cruz-public/api/uctovne-jednotky";

type RuzResponse = {
  nazovUJ?: string;
  adresa?: string;
  dic?: string;
  ico?: string;
};

export async function lookupRuzByIco(
  ico: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterLookup | null> {
  const url = `${RUZ_BASE}?ico=${encodeURIComponent(ico.trim())}`;
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": "hugo-accounting/1.0" },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`RÚZ lookup failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as RuzResponse | RuzResponse[];
  const row = Array.isArray(body) ? body[0] : body;
  if (!row?.ico || !row.nazovUJ) {
    return null;
  }
  return {
    country: "SK",
    ico: String(row.ico).trim(),
    legalName: row.nazovUJ.trim(),
    address: (row.adresa ?? "").trim(),
    dic: (row.dic ?? "").trim(),
  };
}
