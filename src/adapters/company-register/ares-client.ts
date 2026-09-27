import type { RegisterEntityStatus, RegisterLookup, RegisterSearchHit } from "@/modules/company-profile";

const ARES_BASE = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

type AresSidlo = {
  textovaAdresa?: string;
};

type AresSubject = {
  ico?: string;
  obchodniJmeno?: string;
  dic?: string;
  sidlo?: AresSidlo;
  seznamRegistraci?: {
    stavZdrojeRos?: string;
    stavZdrojeRes?: string;
  };
};

type AresSearchResponse = {
  ekonomickeSubjekty?: AresSubject[];
};

function mapAresStatus(subject: AresSubject): RegisterEntityStatus {
  const ros = subject.seznamRegistraci?.stavZdrojeRos;
  const res = subject.seznamRegistraci?.stavZdrojeRes;
  if (ros === "ZANIKLY" || res === "ZANIKLY") {
    return "dissolved";
  }
  return "active";
}

function mapAresSubject(subject: AresSubject): RegisterSearchHit | null {
  const ico = subject.ico?.trim();
  const legalName = subject.obchodniJmeno?.trim();
  if (!ico || !legalName) {
    return null;
  }
  return {
    ico,
    legalName,
    address: subject.sidlo?.textovaAdresa?.trim() ?? "",
    status: mapAresStatus(subject),
  };
}

function mapAresLookup(subject: AresSubject): RegisterLookup | null {
  const hit = mapAresSubject(subject);
  if (!hit) {
    return null;
  }
  return {
    country: "CZ",
    ico: hit.ico,
    legalName: hit.legalName,
    address: hit.address,
    dic: (subject.dic ?? "").trim(),
  };
}

export async function searchAresByName(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterSearchHit[]> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const response = await fetchImpl(`${ARES_BASE}/vyhledat`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "hugo-accounting/1.0",
    },
    body: JSON.stringify({ obchodniJmeno: trimmed, start: 0, pocet: 50 }),
  });
  if (!response.ok) {
    throw new Error(`ARES search failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as AresSearchResponse;
  const hits: RegisterSearchHit[] = [];
  for (const row of body.ekonomickeSubjekty ?? []) {
    const hit = mapAresSubject(row);
    if (hit) {
      hits.push(hit);
    }
  }
  return hits;
}

export async function lookupAresByIco(
  ico: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterLookup | null> {
  const trimmed = ico.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const response = await fetchImpl(`${ARES_BASE}/${encodeURIComponent(trimmed)}`, {
    headers: { Accept: "application/json", "User-Agent": "hugo-accounting/1.0" },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`ARES lookup failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as AresSubject;
  return mapAresLookup(body);
}
