import {
  findSubjectByIco,
  findSubjectByVatId,
  findSubjectsByIco,
  type SubjectRow,
} from "@/adapters/store/subjects";
import type { ConfirmedPayload, ExtractedPayload } from "@/modules/document-payload";
import {
  mergeDocumentFields,
  type MergedDocumentFields,
  type MergeDocumentFieldsOptions,
} from "@/modules/document-fields";
import type { DirectoryFactsByKey, DirectoryPartyFacts } from "@/modules/party-enrichment";
import type { PartyIdentity } from "@/modules/party-roles";
import {
  directoryKeyOf,
  subjectCountryOf,
  subjectKeyOf,
  type SubjectKey,
} from "@/modules/subject-directory";

/**
 * What the shared subject directory says about the parties of a document, for
 * the values it may fill (ADR 0022). It reads the directory's rows only: a page,
 * the export and the worker's merge call this, and no register is ever asked here.
 */

/** Facts already read in one request, by subject key: a counterparty recurs across documents. */
export type DirectoryFactsCache = Map<string, Promise<DirectoryPartyFacts | null>>;

/** The subject a key names, as the directory stores it: by IČO, or by VAT ID when there is none. */
async function subjectOfKey(key: SubjectKey): Promise<SubjectRow | null> {
  if (key.ico && key.country !== "foreign") {
    return findSubjectByIco(key.country, key.ico);
  }
  return key.vatId ? findSubjectByVatId(key.vatId) : null;
}

/**
 * A party with an IČO and no country signal: the Slovak subject holding the IČO in the
 * register, else the Czech one — the order the party check asks the registers in.
 */
async function subjectOfIcoAlone(ico: string): Promise<SubjectRow | null> {
  const holders = (await findSubjectsByIco(ico)).filter((subject) => subject.legalName);
  return holders.find((subject) => subject.country === "SK") ?? holders.find((subject) => subject.country === "CZ") ?? null;
}

/** How a party finds its subject for the fill: the key the merge reads, and the lookup it names. */
function lookupOf(party: PartyIdentity): { id: string; find: () => Promise<SubjectRow | null> } | null {
  const id = directoryKeyOf(party);
  if (id === null) {
    return null;
  }
  const key = subjectKeyOf(party, subjectCountryOf(party));
  if (key) {
    return { id, find: () => subjectOfKey(key) };
  }
  const ico = party.ico.replace(/\s+/g, "");
  return { id, find: () => subjectOfIcoAlone(ico) };
}

function factsOf(subject: SubjectRow): DirectoryPartyFacts | null {
  const facts: DirectoryPartyFacts = {
    name: subject.legalName ?? "",
    dic: subject.dic ?? "",
    icDph: subject.icDph ?? "",
  };
  return facts.name || facts.dic || facts.icDph ? facts : null;
}

/**
 * The directory's facts for the subjects of these parties, by subject key. A
 * party with no subject key, or whose subject the directory does not hold, has
 * no entry: nothing is filled for it.
 */
export async function directoryFactsFor(
  parties: readonly PartyIdentity[],
  cache: DirectoryFactsCache = new Map(),
): Promise<DirectoryFactsByKey> {
  const facts: DirectoryFactsByKey = {};
  for (const party of parties) {
    const lookup = lookupOf(party);
    if (!lookup) {
      continue;
    }
    const { id, find } = lookup;
    let pending = cache.get(id);
    if (!pending) {
      pending = find().then((subject) => (subject ? factsOf(subject) : null));
      cache.set(id, pending);
    }
    const found = await pending;
    if (found) {
      facts[id] = found;
    }
  }
  return facts;
}

function partiesOf(fields: MergedDocumentFields["fields"]): { supplier: PartyIdentity; customer: PartyIdentity } {
  return {
    supplier: { name: fields.supplierName, ico: fields.ico, dic: fields.dic, icDph: fields.icDph },
    customer: { name: fields.customerName, ico: fields.customerIco, dic: fields.customerDic, icDph: fields.customerIcDph },
  };
}

/**
 * A document's values as the screens and the worker read them: merged as usual,
 * then with the directory's facts for its parties. The facts are looked up from
 * the values merged first, so the directory never decides which subject it is.
 */
export async function mergeDocumentFieldsWithDirectory(
  extracted: ExtractedPayload,
  confirmed: ConfirmedPayload,
  options: MergeDocumentFieldsOptions,
  cache: DirectoryFactsCache = new Map(),
): Promise<{ merged: MergedDocumentFields; directory: DirectoryFactsByKey }> {
  const base = mergeDocumentFields(extracted, confirmed, options);
  const { supplier, customer } = partiesOf(base.fields);
  const directory = await directoryFactsFor([supplier, customer], cache);
  if (Object.keys(directory).length === 0) {
    return { merged: base, directory };
  }
  return {
    merged: mergeDocumentFields(extracted, confirmed, { ...options, directory }),
    directory,
  };
}
