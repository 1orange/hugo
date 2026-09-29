import type { RegisterLookup } from "@/modules/company-profile";
import { formatSkPostalCode } from "@/modules/register-search";

const RUZ_BASE = "https://www.registeruz.sk/cruz-public/api";

/**
 * The list endpoint returns ids only, and refuses (HTTP 403, from its
 * firewall) a request without `zmenene-od`. Any date before the register
 * existed lists every unit with that IČO.
 */
const RUZ_CHANGED_SINCE = "2000-01-01";

type RuzIdList = {
  id?: number[];
};

type RuzUnit = {
  id?: number;
  ico?: string;
  dic?: string;
  nazovUJ?: string;
  ulica?: string;
  psc?: string;
  mesto?: string;
  datumPoslednejUpravy?: string;
  /** "ZMAZANÉ" for a record the register withdrew; absent otherwise. */
  stav?: string;
};

const RUZ_HEADERS = { Accept: "application/json", "User-Agent": "hugo-accounting/1.0" };

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  const response = await fetchImpl(url, { headers: RUZ_HEADERS });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`RÚZ lookup failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function formatRuzAddress(unit: RuzUnit): string {
  const city = [formatSkPostalCode(unit.psc ?? ""), unit.mesto?.trim() ?? ""].filter(Boolean).join(" ");
  return [unit.ulica?.trim() ?? "", city].filter(Boolean).join(", ");
}

export async function lookupRuzByIco(
  ico: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterLookup | null> {
  const params = new URLSearchParams({ "zmenene-od": RUZ_CHANGED_SINCE, ico: ico.trim() });
  const list = await getJson<RuzIdList>(`${RUZ_BASE}/uctovne-jednotky?${params.toString()}`, fetchImpl);
  // One IČO can hold a live record beside withdrawn ones (Slovnaft has two).
  const ids = (list?.id ?? []).slice(0, 5);
  const units = await Promise.all(
    ids.map((id) => getJson<RuzUnit>(`${RUZ_BASE}/uctovna-jednotka?id=${id}`, fetchImpl)),
  );
  const unit = units
    .filter((row): row is RuzUnit => Boolean(row?.ico && row.nazovUJ) && row?.stav !== "ZMAZANÉ")
    .sort((a, b) => (a.datumPoslednejUpravy ?? "").localeCompare(b.datumPoslednejUpravy ?? ""))
    .at(-1);
  if (!unit) {
    return null;
  }
  return {
    country: "SK",
    ico: String(unit.ico).trim(),
    legalName: unit.nazovUJ!.trim(),
    address: formatRuzAddress(unit),
    dic: (unit.dic ?? "").trim(),
  };
}
