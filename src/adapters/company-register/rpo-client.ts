import type { RegisterEntityStatus, RegisterSearchHit } from "@/modules/company-profile";
import { formatSkPostalCode, longestNameToken } from "@/modules/register-search";

const RPO_SEARCH_URL = "https://api.statistics.sk/rpo/v1/search";

/** Every RPO attribute is a history; the current entry has no `validTo`. */
type Dated = { validFrom?: string; validTo?: string | null };

type RpoAddress = Dated & {
  street?: string;
  regNumber?: number;
  buildingNumber?: string;
  postalCodes?: string[];
  municipality?: { value?: string };
};

type RpoEntity = {
  identifiers?: Array<Dated & { value?: string }>;
  fullNames?: Array<Dated & { value?: string }>;
  addresses?: RpoAddress[];
  /** The date the entity ceased, absent while it exists. */
  termination?: string | null;
};

type RpoSearchResponse = {
  results?: RpoEntity[];
};

function current<T extends Dated>(history: T[] | undefined): T | undefined {
  if (!history || history.length === 0) {
    return undefined;
  }
  return (
    history.find((entry) => !entry.validTo) ??
    [...history].sort((a, b) => (a.validTo ?? "").localeCompare(b.validTo ?? "")).at(-1)
  );
}

function formatRpoAddress(address: RpoAddress | undefined): string {
  if (!address) {
    return "";
  }
  const building = address.buildingNumber?.trim() ?? "";
  const registry = address.regNumber && address.regNumber > 0 ? String(address.regNumber) : "";
  const number = registry && building && !building.includes("/") ? `${registry}/${building}` : building || registry;
  const municipality = address.municipality?.value?.trim() ?? "";
  // A village without streets is addressed by the village and its number.
  const street = [address.street?.trim() || municipality, number].filter(Boolean).join(" ");
  const psc = formatSkPostalCode(address.postalCodes?.[0] ?? "");
  const city = [psc, municipality].filter(Boolean).join(" ");
  return [street, city].filter(Boolean).join(", ");
}

function mapStatus(entity: RpoEntity): RegisterEntityStatus {
  return entity.termination ? "dissolved" : "active";
}

function mapRpoEntity(entity: RpoEntity): RegisterSearchHit | null {
  const ico = current(entity.identifiers)?.value?.trim();
  const legalName = current(entity.fullNames)?.value?.trim();
  if (!ico || !legalName) {
    return null;
  }
  return {
    ico,
    legalName,
    address: formatRpoAddress(current(entity.addresses)),
    status: mapStatus(entity),
  };
}

async function fetchRpo(fullName: string, fetchImpl: typeof fetch): Promise<RegisterSearchHit[]> {
  const url = `${RPO_SEARCH_URL}?fullName=${encodeURIComponent(fullName)}`;
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": "hugo-accounting/1.0" },
  });
  if (!response.ok) {
    throw new Error(`RPO search failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as RpoSearchResponse;
  const hits: RegisterSearchHit[] = [];
  const seen = new Set<string>();
  for (const entity of body.results ?? []) {
    const hit = mapRpoEntity(entity);
    if (hit && !seen.has(hit.ico)) {
      seen.add(hit.ico);
      hits.push(hit);
    }
  }
  return hits;
}

/**
 * RPO matches the name as one literal substring, any of its former names
 * included, and returns at most 500 entities: "spring etc" finds nothing
 * where "spring.etc" finds SPRING.etc., spol. s r. o. A query of several words
 * that finds nothing is asked again by its longest word; ranking the hits
 * against every word is the caller's (register-search module).
 */
export async function searchRpoByName(
  fullName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterSearchHit[]> {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const hits = await fetchRpo(trimmed, fetchImpl);
  const fallback = longestNameToken(trimmed);
  if (hits.length > 0 || !fallback || fallback === trimmed.toLowerCase()) {
    return hits;
  }
  return fetchRpo(fallback, fetchImpl);
}
