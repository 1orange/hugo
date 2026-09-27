import type { RegisterEntityStatus, RegisterSearchHit } from "@/modules/company-profile";

const RPO_SEARCH_URL = "https://api.statistics.sk/rpo/v1/search";

type RpoSearchResponse = {
  results?: Array<{
    identifier?: string;
    fullNames?: Array<{ value?: string }>;
    addresses?: Array<{ formattedAddress?: string }>;
    termination?: { terminatedOn?: string | null } | null;
  }>;
};

function mapStatus(
  termination: { terminatedOn?: string | null } | null | undefined,
): RegisterEntityStatus {
  if (termination?.terminatedOn) {
    return "dissolved";
  }
  return "active";
}

export async function searchRpoByName(
  fullName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterSearchHit[]> {
  const url = `${RPO_SEARCH_URL}?fullName=${encodeURIComponent(fullName.trim())}`;
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": "hugo-accounting/1.0" },
  });
  if (!response.ok) {
    throw new Error(`RPO search failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as RpoSearchResponse;
  const results = body.results ?? [];
  const hits: RegisterSearchHit[] = [];
  for (const row of results) {
    const ico = row.identifier?.trim();
    const legalName = row.fullNames?.[0]?.value?.trim();
    const address = row.addresses?.[0]?.formattedAddress?.trim();
    if (!ico || !legalName) {
      continue;
    }
    hits.push({
      ico,
      legalName,
      address: address ?? "",
      status: mapStatus(row.termination),
    });
  }
  return hits;
}
