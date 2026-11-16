import { normalizeCompanyName } from "./register-search";

/**
 * Search over the subject directory (ADR 0022, PRD 0004 story 48): by name, former
 * name, alias, IČO, DIČ or IČ DPH. Names ignore case, diacritics, punctuation and
 * spacing; identifiers ignore spacing and case, and a DIČ or IČ DPH matches with
 * or without its country prefix. Pure, so the list screen and its tests share it.
 */

export type SearchableSubject = {
  id: number;
  legalName: string | null;
  formerNames: string[];
  /** The names the subject is printed under on documents. */
  aliases: string[];
  ico: string | null;
  dic: string | null;
  icDph: string | null;
  vatId: string | null;
};

/** Shorter text is too common to match inside a name without spacing (two letters match most names). */
const MIN_COMPACT_LENGTH = 3;
/** Shorter numbers match too many identifiers to be a search. */
const MIN_IDENTIFIER_LENGTH = 3;

/** A name with its spacing removed, so "a.s." and "as" meet: "Slovnaft, a. s." → "slovnaft a s" → "slovnafta s" → "slovnaftas". */
function compactName(value: string): string {
  return normalizeCompanyName(value).replace(/ /g, "");
}

/** An identifier as typed or stored, with the spacing and case gone: "sk 2020 322 832" → "SK2020322832". */
function compactIdentifier(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

function namesOf(subject: SearchableSubject): string[] {
  return [subject.legalName, ...subject.formerNames, ...subject.aliases].filter(
    (name): name is string => typeof name === "string" && name.trim().length > 0,
  );
}

function identifiersOf(subject: SearchableSubject): string[] {
  return [subject.ico, subject.dic, subject.icDph, subject.vatId].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

/** Whether the subject answers the query. An empty query answers every subject. */
export function matchesSubjectSearch(subject: SearchableSubject, query: string | null | undefined): boolean {
  const typed = (query ?? "").trim();
  if (typed.length === 0) {
    return true;
  }

  const names = namesOf(subject);
  const folded = normalizeCompanyName(typed);
  if (folded.length > 0 && names.some((name) => normalizeCompanyName(name).includes(folded))) {
    return true;
  }
  const compactQuery = folded.replace(/ /g, "");
  if (compactQuery.length >= MIN_COMPACT_LENGTH && names.some((name) => compactName(name).includes(compactQuery))) {
    return true;
  }

  const identifier = compactIdentifier(typed);
  if (/\d/.test(identifier) && identifier.length >= MIN_IDENTIFIER_LENGTH) {
    return identifiersOf(subject).some((value) => compactIdentifier(value).includes(identifier));
  }
  return false;
}

/**
 * The subjects that answer the query, in the order given, with how many matched
 * in all: the list shows `limit` of them and says how many there are.
 */
export function searchSubjects<T extends SearchableSubject>(
  subjects: readonly T[],
  query: string | null | undefined,
  limit: number,
): { rows: T[]; total: number } {
  const matches = subjects.filter((subject) => matchesSubjectSearch(subject, query));
  return { rows: matches.slice(0, limit), total: matches.length };
}
