import type { RegisterSearchHit } from "./company-profile";

/**
 * Legal forms as they read once punctuation is gone: "spol. s r. o.",
 * "s.r.o.", "a. s." and the rest say nothing about which company is meant.
 */
const LEGAL_FORMS =
  /(?:^| )(?:spol s r o|s r o|a s|k s|v o s|s e|n o|z s|v likvidacii|v konkurze)(?= |$)/g;

/** Lowercase, without diacritics or punctuation: "SPRING.etc., spol. s r. o." → "spring etc spol s r o". */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The name without its legal form: "SPRING.etc., spol. s r. o." → "spring etc". */
export function coreCompanyName(name: string): string {
  return normalizeCompanyName(name).replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();
}

/** The word a literal-substring register is asked for when the whole query finds nothing. */
export function longestNameToken(query: string): string | null {
  const tokens = coreCompanyName(query).split(" ").filter((token) => token.length >= 3);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
}

/** "84105" → "841 05"; anything else as given. */
export function formatSkPostalCode(raw: string): string {
  const digits = raw.replace(/\s/g, "");
  return /^\d{5}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3)}` : raw.trim();
}

/**
 * How well a name answers the query, best first: the same name; the query as
 * its first word ("spring" → SPRING.etc.); as the start of it (Springa); every
 * word starting a word of it; then by how many words are inside it — none is a
 * register that matched a former name.
 */
function matchTier(queryCore: string, nameCore: string): number {
  if (nameCore === queryCore) {
    return 0;
  }
  if (nameCore.startsWith(`${queryCore} `)) {
    return 1;
  }
  if (nameCore.startsWith(queryCore)) {
    return 2;
  }
  const tokens = queryCore.split(" ");
  const words = nameCore.split(" ");
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) {
    return 3;
  }
  const missing = tokens.filter((token) => !nameCore.includes(token)).length;
  return 4 + missing;
}

/**
 * Register hits in the order she should read them: a name search returns
 * hundreds ("spring" gives 123 in RPO, with sole traders and former names),
 * and the register's own order is by id. Live companies come first, then the
 * closer match, then the shorter name.
 */
export function rankRegisterHits(query: string, hits: RegisterSearchHit[]): RegisterSearchHit[] {
  const queryCore = coreCompanyName(query) || normalizeCompanyName(query);
  if (!queryCore) {
    return hits;
  }
  const scored = hits.map((hit) => {
    const nameCore = coreCompanyName(hit.legalName);
    return {
      hit,
      status: hit.status === "active" ? 0 : 1,
      tier: matchTier(queryCore, nameCore),
      length: nameCore.length,
    };
  });
  scored.sort(
    (a, b) =>
      a.status - b.status ||
      a.tier - b.tier ||
      a.length - b.length ||
      a.hit.legalName.localeCompare(b.hit.legalName, "sk"),
  );
  return scored.map((entry) => entry.hit);
}
