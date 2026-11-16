import type { CompanyRegister } from "@/adapters/company-register/port";
import type { VatNumberCheck, VatRegister } from "@/adapters/vat-register/port";
import {
  findCompanyProfileByIco,
  findSubjectByIco,
  findSubjectByVatId,
  findSubjectsByAlias,
  getSubject,
  insertSubject,
  recordAliasSighting,
  unlinkCompanySubjectsExcept,
  updateSubject,
  type SubjectPatch,
  type SubjectRow,
} from "@/adapters/store/subjects";
import type { RegisterLookup } from "@/modules/company-profile";
import { isValidIcoChecksum } from "@/modules/ico-checksum";
import { normalizeCompanyName } from "@/modules/register-search";
import type { PartyIdentity } from "@/modules/party-roles";
import {
  aliasKeyOf,
  applyRegisterFacts,
  correctSubjectField as correctField,
  correctVatGroup,
  groupVatIdOf,
  icDphConfirmedByVies,
  isStale,
  nextViesRecord,
  pickAliasSubject,
  profileFindings,
  recordVatGroupFromVies,
  registerAnswerOf,
  subjectCountryOf,
  subjectKeyOf,
  viesAnswerOf,
  viesTargetOf,
  type RegisterFacts,
  type SubjectCountry,
  type SubjectField,
  type SubjectKey,
  type SubjectState,
  type ViesRecord,
} from "@/modules/subject-directory";
import {
  isGroupRegistrationHolder,
  type NotFound,
  type RegisterInput,
  type ViesAnswer,
  type Unavailable,
} from "@/modules/subject-integrity";
import type { LookupLock } from "./lookup-lock";
import type { LookupRateLimiter } from "./rate-limit";

/**
 * The shared subject directory (ADR 0022): resolves a party to its subject,
 * fetches what is unknown or stale from the register, and records the name a
 * subject was printed under. Runs on the worker; pages never call it.
 */

/** A lookup refused by the rate limit for a subject the directory does not hold yet: tried again later. */
export class SubjectLookupDeferred extends Error {
  constructor() {
    super("Príliš veľa dotazov na register — overenie sa zopakuje neskôr.");
    this.name = "SubjectLookupDeferred";
  }
}

/** The document whose check this sighting comes from: a name counts once per document (ADR 0022). */
export type Sighting = { documentId: string };

export type DirectoryDeps = {
  register: CompanyRegister;
  /** VIES, asked once per subject and VAT ID per refresh period (ADR 0018 amendment). */
  vat: VatRegister;
  lock: LookupLock;
  limiter: LookupRateLimiter;
  /** Register data older than this is refreshed on the next sighting (settings, default 30). */
  refreshDays: number;
  now: () => string;
  /** How long a caller waits for another replica's lookup of the same subject. */
  waitMs?: number;
};

const LOCK_TTL_MS = 60_000;
const DEFAULT_WAIT_MS = 30_000;

/** What a party's counterparty check gets from the directory. */
export type CounterpartyCheck = {
  subjectId: number | null;
  /** The register's answer for the integrity check; undefined when nothing is known and none was asked. */
  register: RegisterInput | undefined;
  /** VIES's answer for the party's VAT ID; undefined when the party prints none VIES can answer. */
  vies?: ViesAnswer | Unavailable;
  /** The VAT group the subject is recorded as a member of. */
  vatGroupId?: string | null;
};

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

/** What the integrity check reads: the subject's register answer, not-found, or nothing yet. */
function answerOf(subject: SubjectRow): RegisterInput | undefined {
  const answer = registerAnswerOf(subject);
  if (answer) {
    return answer;
  }
  // Looked up and absent from the register: verified, with no name to give.
  return subject.verifiedAt ? ({ notFound: true } satisfies NotFound) : undefined;
}

function stateOf(subject: SubjectRow): SubjectState {
  return subject;
}

function emptyStateOf(country: SubjectCountry, ico: string | null, vatId: string | null): SubjectState {
  return {
    country,
    ico,
    vatId,
    legalName: null,
    formerNames: [],
    dic: null,
    icDph: null,
    address: null,
    registerStatus: "unknown",
    sources: {},
    manualFields: [],
    findings: [],
    verifiedAt: null,
  };
}

function factsOf(lookup: RegisterLookup): RegisterFacts {
  return {
    legalName: lookup.legalName,
    formerNames: lookup.formerNames ?? [],
    dic: lookup.dic.trim() || null,
    address: lookup.address,
    status: lookup.status ?? "active",
  };
}

/**
 * By IČO for an SK or CZ party. A party with an IČO is never matched by its VAT ID:
 * a VAT group's IČ DPH belongs to several members, so it would name the wrong one.
 */
async function findByKey(key: SubjectKey): Promise<SubjectRow | null> {
  if (key.ico && key.country !== "foreign") {
    return findSubjectByIco(key.country, key.ico);
  }
  return key.vatId ? findSubjectByVatId(key.vatId) : null;
}

/**
 * The subject a party is, if the directory holds it (ADR 0022): by IČO, then
 * VAT ID, then an exact alias. The alias is asked only of a party with no IČO,
 * so that an unknown IČO is never taken for another company's.
 */
export async function resolveSubject(
  party: PartyIdentity,
  country: SubjectCountry | null = subjectCountryOf(party),
): Promise<SubjectRow | null> {
  const key = subjectKeyOf(party, country);
  if (key) {
    const found = await findByKey(key);
    if (found) {
      return found;
    }
  }
  const alias = aliasKeyOf(party.name);
  if (compact(party.ico) === "" && alias.length > 0) {
    return pickAliasSubject(await findSubjectsByAlias(alias));
  }
  return null;
}

/** The subject as it is now, for the lookup key: found by IČO, or the one learned by VAT ID that gets its IČO. */
async function currentFor(
  known: SubjectRow | null,
  country: SubjectCountry,
  ico: string,
): Promise<SubjectRow | null> {
  const byIco = await findSubjectByIco(country, ico);
  if (byIco) {
    return byIco;
  }
  return known && known.ico === null ? getSubject(known.id) : null;
}

/**
 * One sighting: the name it was printed under counts once for this document, and a
 * client's subject is linked to its company. Every party with a name is recorded;
 * only a party without an IČO is resolved by its name (resolveSubject).
 */
async function sighted(
  subject: SubjectRow,
  party: PartyIdentity,
  now: string,
  sighting: Sighting,
): Promise<CounterpartyCheck> {
  const printed = party.name.trim();
  const alias = normalizeCompanyName(printed);
  if (alias.length > 0) {
    await recordAliasSighting({
      subjectId: subject.id,
      normalizedName: alias,
      displayName: printed,
      documentId: sighting.documentId,
      now,
    });
  }
  let current = (await updateSubject(subject.id, { lastSeenAt: now })) ?? subject;
  if (current.linkedCompanyId === null && current.ico && current.country !== "foreign") {
    const profile = await findCompanyProfileByIco(current.country, current.ico);
    if (profile) {
      current =
        (await linkSubject(current, { companyId: profile.companyId, legalName: profile.legalName, dic: profile.dic }, now)) ??
        current;
    }
  }
  return { subjectId: current.id, register: answerOf(current) };
}

/**
 * The counterparty's subject, its register answer, and its VIES answer for the
 * party's VAT ID (ADR 0022, PRD 0004): a fresh subject is only sighted, an unknown
 * or stale one is looked up. VIES is asked once per subject and VAT ID per refresh
 * period. An outage of either leaves the other answer as it is.
 */
export async function verifyCounterparty(
  party: PartyIdentity,
  deps: DirectoryDeps,
  sighting: Sighting,
): Promise<CounterpartyCheck> {
  const check = await checkRegister(party, deps, sighting);
  // The register part of the answer, then VIES on the subject it resolved to.
  if (check.subjectId === null) {
    return check;
  }
  const subject = await getSubject(check.subjectId);
  const vatId = viesTargetOf(party, subjectCountryOf(party));
  if (!subject || !vatId) {
    return { ...check, vatGroupId: subject?.vatGroupId ?? null };
  }
  const vies = await viesAnswerFor(subject, vatId, deps);
  // A VAT ID VIES holds under the subject's own name is the subject's IČ DPH (ADR 0022).
  const icDph = icDphConfirmedByVies(subject, vatId, vies);
  if (icDph) {
    await updateSubject(subject.id, icDph);
  }
  return { ...check, vies, vatGroupId: subject.vatGroupId };
}

/**
 * The subject a counterparty of the Omega export is, read through the directory (ADR 0019,
 * ADR 0022). A known, fresh subject is read with no register call; an unknown or stale one
 * is looked up once through the directory, so the answer is recorded there. A register
 * outage, a lookup the rate limit defers, or a failing lock leaves the stored subject, or
 * none: the export does not fail for them. With no `deps` (no register at hand) the
 * directory is only read. A party with neither an IČO nor a VAT ID is not looked up at all.
 */
export async function subjectForExport(
  party: PartyIdentity,
  country: SubjectCountry,
  deps: DirectoryDeps | null,
  sighting: Sighting,
): Promise<SubjectRow | null> {
  if (subjectKeyOf(party, country) === null) {
    return null;
  }
  const stored = () => resolveSubject(party, country);
  if (!deps) {
    return stored();
  }
  try {
    const check = await checkRegister(party, deps, sighting, country);
    return check.subjectId === null ? stored() : getSubject(check.subjectId);
  } catch {
    return stored();
  }
}

/**
 * VIES's answer for one VAT ID of a subject. A record younger than the refresh age is
 * the answer; otherwise VIES is asked, once across the replicas, and a VIES outage
 * answers with the record held, or unavailable when there is none.
 */
async function viesAnswerFor(
  subject: SubjectRow,
  vatId: string,
  deps: DirectoryDeps,
): Promise<ViesAnswer | Unavailable> {
  const fresh = (record: ViesRecord | undefined): ViesRecord | null =>
    record && !isStale(record.checkedAt, deps.now(), deps.refreshDays) ? record : null;
  const known = fresh(subject.viesStatus[vatId]);
  if (known) {
    return viesAnswerOf(known);
  }

  const lockKey = `vies:${subject.id}:${vatId}`;
  const token = await deps.lock.tryAcquire(lockKey, LOCK_TTL_MS);
  if (token === null) {
    // Another replica is asking VIES for this VAT ID: take what it stores.
    await deps.lock.waitUntilFree(lockKey, deps.waitMs ?? DEFAULT_WAIT_MS);
    const after = fresh((await getSubject(subject.id))?.viesStatus[vatId]);
    return after ? viesAnswerOf(after) : { unavailable: true };
  }
  try {
    const current = await getSubject(subject.id);
    const held = current?.viesStatus[vatId];
    const stillFresh = fresh(held);
    if (stillFresh) {
      return viesAnswerOf(stillFresh);
    }
    if (!deps.limiter.tryTake()) {
      if (held) {
        return viesAnswerOf(held);
      }
      throw new SubjectLookupDeferred();
    }

    let answer: VatNumberCheck;
    try {
      answer = await deps.vat.check(vatId);
    } catch {
      return held ? viesAnswerOf(held) : { unavailable: true };
    }
    const record = nextViesRecord(held, answer.valid ? answer : { valid: false, name: null }, deps.now());
    await updateSubject(subject.id, { viesStatus: { ...(current?.viesStatus ?? {}), [vatId]: record } });
    return viesAnswerOf(record);
  } finally {
    await deps.lock.release(lockKey, token);
  }
}

/**
 * Records a subject as a member of a VAT group, from a confirmed document that shows its
 * IČO with that group IČ DPH, which VIES reports as "Group registration" (PRD 0004, story 33).
 * Returns the counterparty check with the membership it now holds.
 */
export async function recordGroupMembershipOf(
  party: PartyIdentity,
  check: CounterpartyCheck,
  now: string,
): Promise<CounterpartyCheck> {
  const vies = check.vies;
  if (check.subjectId === null || !vies || !("valid" in vies) || !vies.valid) {
    return check;
  }
  if (!isGroupRegistrationHolder(vies.holderName)) {
    return check;
  }
  const group = groupVatIdOf(party.icDph);
  const subject = await getSubject(check.subjectId);
  if (!group || !subject || subject.ico === null || subject.ico !== compact(party.ico)) {
    return check;
  }
  if (subject.vatGroupId === group) {
    return check;
  }
  const updated = await updateSubject(subject.id, recordVatGroupFromVies(stateOf(subject), group));
  return { ...check, vatGroupId: updated?.vatGroupId ?? group };
}

/**
 * Her record of a subject's VAT group (ADR 0022, PRD 0004 story 33): the group's VAT ID,
 * or null when the subject is no longer recorded in one. Marked manual, like any correction.
 */
export async function setSubjectVatGroup(subjectId: number, groupVatId: string | null): Promise<SubjectRow | null> {
  const subject = await getSubject(subjectId);
  if (!subject) {
    return null;
  }
  return updateSubject(subjectId, correctVatGroup(stateOf(subject), groupVatId) as SubjectPatch);
}

/**
 * Makes the subject answer for a counterparty: a fresh one is only sighted;
 * an unknown or stale one is looked up once across the replicas, with the
 * lookup rate-limited. A register outage leaves the directory as it was.
 */
async function checkRegister(
  party: PartyIdentity,
  deps: DirectoryDeps,
  sighting: Sighting,
  countryOfParty: SubjectCountry | null = subjectCountryOf(party),
): Promise<CounterpartyCheck> {
  const country = countryOfParty;
  const key = subjectKeyOf(party, country);
  const ico = compact(party.ico);
  if (!key && country === null && isValidIcoChecksum(ico)) {
    return checkIcoWithoutCountry(party, ico, deps, sighting);
  }
  const known = await resolveSubject(party, country);
  if (!known && !key) {
    return { subjectId: null, register: undefined };
  }
  if (known && !isStale(known.verifiedAt, deps.now(), deps.refreshDays)) {
    return sighted(known, party, deps.now(), sighting);
  }

  // Only an SK or CZ IČO can be looked up; anything else is kept as a subject with no register data.
  const lookupCountry = known?.country ?? key?.country ?? "foreign";
  const lookupIco = known?.ico ?? key?.ico ?? null;
  if (!lookupIco || lookupCountry === "foreign") {
    const subject = known ?? (await insertSubject({
      country: lookupCountry,
      ico: null,
      vatId: key?.vatId ?? null,
      now: deps.now(),
    }));
    return sighted(subject, party, deps.now(), sighting);
  }

  const lockKey = `${lookupCountry}:${lookupIco}`;
  const token = await deps.lock.tryAcquire(lockKey, LOCK_TTL_MS);
  if (token === null) {
    // Another lookup of this subject is in flight: take what it leaves, without a second call.
    await deps.lock.waitUntilFree(lockKey, deps.waitMs ?? DEFAULT_WAIT_MS);
    const after = await currentFor(known, lookupCountry, lookupIco);
    return after ? sighted(after, party, deps.now(), sighting) : { subjectId: null, register: { unavailable: true } };
  }
  try {
    return await refreshUnderLock({ party, deps, known, key, country: lookupCountry, ico: lookupIco, sighting });
  } finally {
    await deps.lock.release(lockKey, token);
  }
}

async function refreshUnderLock(input: {
  party: PartyIdentity;
  deps: DirectoryDeps;
  known: SubjectRow | null;
  key: SubjectKey | null;
  country: Exclude<SubjectCountry, "foreign">;
  ico: string;
  sighting: Sighting;
}): Promise<CounterpartyCheck> {
  const { party, deps, known, key, country, ico, sighting } = input;
  // The lookup this caller waited for may have finished before it took the key.
  const current = await currentFor(known, country, ico);
  if (current && !isStale(current.verifiedAt, deps.now(), deps.refreshDays)) {
    return sighted(current, party, deps.now(), sighting);
  }
  if (!deps.limiter.tryTake()) {
    // A subject with data is judged on that data until the next sighting; an unknown one waits.
    if (current) {
      return sighted(current, party, deps.now(), sighting);
    }
    throw new SubjectLookupDeferred();
  }

  let lookup: RegisterLookup | null;
  try {
    lookup = await deps.register.lookupByIco(ico, country, { withHistory: true });
  } catch {
    // An outage leaves the directory as it was (ADR 0022): the answer is what it held, or unavailable.
    if (current) {
      return sighted(current, party, deps.now(), sighting);
    }
    return { subjectId: null, register: { unavailable: true } satisfies Unavailable };
  }

  const now = deps.now();
  if (!lookup) {
    // Absent from the register: recorded as verified, with no name.
    const subject = current
      ? await updateSubject(current.id, { verifiedAt: now, ...(current.ico === null ? { ico } : {}) })
      : await insertSubject({ country, ico, vatId: key?.vatId ?? null, verifiedAt: now, now });
    return sighted(subject!, party, now, sighting);
  }

  const subject = await storeRegisterFacts({ current, country, ico, vatId: key?.vatId ?? null, lookup, now });
  return sighted(subject, party, now, sighting);
}

/** The register's answer, written to the subject it is about: updated, or created. */
async function storeRegisterFacts(input: {
  current: SubjectRow | null;
  country: Exclude<SubjectCountry, "foreign">;
  ico: string;
  vatId: string | null;
  lookup: RegisterLookup;
  now: string;
}): Promise<SubjectRow> {
  const { current, country, ico, vatId, lookup, now } = input;
  const update = applyRegisterFacts(current ? stateOf(current) : emptyStateOf(country, ico, vatId), factsOf(lookup), now);
  const subject = current
    ? await updateSubject(current.id, { ...update, ...(current.ico === null ? { ico } : {}) })
    : await insertSubject({
        country,
        ico,
        vatId,
        legalName: update.legalName ?? null,
        formerNames: update.formerNames,
        dic: update.dic ?? null,
        address: update.address ?? null,
        registerStatus: update.registerStatus,
        sources: update.sources,
        verifiedAt: now,
        now,
      });
  return subject!;
}

/** The registers an IČO with nothing else to place it is looked up in, in order (2026-11-12). */
const ICO_ONLY_COUNTRIES = ["SK", "CZ"] as const;

type IcoLookup = { kind: "found"; subject: SubjectRow } | { kind: "absent" } | { kind: "unavailable" };

function outcomeOf(subject: SubjectRow | null): IcoLookup {
  if (subject && registerAnswerOf(subject)) {
    return { kind: "found", subject };
  }
  return subject?.verifiedAt ? { kind: "absent" } : { kind: "unavailable" };
}

/**
 * One register's answer for an IČO, under the same lock as any lookup of that subject. An
 * absence is recorded on a subject that already exists, and creates none: the IČO may yet
 * be the other country's.
 */
async function lookUpIcoIn(
  country: (typeof ICO_ONLY_COUNTRIES)[number],
  ico: string,
  deps: DirectoryDeps,
): Promise<IcoLookup> {
  const lockKey = `${country}:${ico}`;
  const token = await deps.lock.tryAcquire(lockKey, LOCK_TTL_MS);
  if (token === null) {
    await deps.lock.waitUntilFree(lockKey, deps.waitMs ?? DEFAULT_WAIT_MS);
    return outcomeOf(await findSubjectByIco(country, ico));
  }
  try {
    const current = await findSubjectByIco(country, ico);
    if (current && !isStale(current.verifiedAt, deps.now(), deps.refreshDays)) {
      return outcomeOf(current);
    }
    const held: IcoLookup | null = current && registerAnswerOf(current) ? { kind: "found", subject: current } : null;
    if (!deps.limiter.tryTake()) {
      if (held) {
        return held;
      }
      throw new SubjectLookupDeferred();
    }
    let lookup: RegisterLookup | null;
    try {
      lookup = await deps.register.lookupByIco(ico, country, { withHistory: true });
    } catch {
      return held ?? { kind: "unavailable" };
    }
    const now = deps.now();
    if (!lookup) {
      if (current) {
        await updateSubject(current.id, { verifiedAt: now });
      }
      return { kind: "absent" };
    }
    return { kind: "found", subject: await storeRegisterFacts({ current, country, ico, vatId: null, lookup, now }) };
  } finally {
    await deps.lock.release(lockKey, token);
  }
}

/**
 * A party printing an IČO and nothing that says its country (no DIČ, no IČ DPH): the
 * Slovak register is asked first, then the Czech one, and the first that holds the IČO
 * names the subject. A subject the directory already holds with fresh data is taken
 * without a call. Neither holding it is not-found; a register that did not answer,
 * while neither held it, leaves it unavailable.
 */
async function checkIcoWithoutCountry(
  party: PartyIdentity,
  ico: string,
  deps: DirectoryDeps,
  sighting: Sighting,
): Promise<CounterpartyCheck> {
  for (const country of ICO_ONLY_COUNTRIES) {
    const known = await findSubjectByIco(country, ico);
    if (known && registerAnswerOf(known) && !isStale(known.verifiedAt, deps.now(), deps.refreshDays)) {
      return sighted(known, party, deps.now(), sighting);
    }
  }
  let unavailable = false;
  for (const country of ICO_ONLY_COUNTRIES) {
    const outcome = await lookUpIcoIn(country, ico, deps);
    if (outcome.kind === "found") {
      return sighted(outcome.subject, party, deps.now(), sighting);
    }
    unavailable ||= outcome.kind === "unavailable";
  }
  return {
    subjectId: null,
    register: unavailable ? ({ unavailable: true } satisfies Unavailable) : ({ notFound: true } satisfies NotFound),
  };
}

async function linkSubject(
  subject: SubjectRow,
  profile: { companyId: number; legalName: string; dic: string },
  now: string,
): Promise<SubjectRow | null> {
  await unlinkCompanySubjectsExcept(profile.companyId, subject.id);
  const kept = subject.findings.filter((finding) => finding.kind !== "profile-disagrees");
  return updateSubject(subject.id, {
    linkedCompanyId: profile.companyId,
    findings: [...kept, ...profileFindings(stateOf(subject), profile, now)],
  });
}

/**
 * Her client's own company as a subject (ADR 0022): found or created by its
 * profile's IČO and linked to it. The profile wins where they disagree; the
 * directory's value is flagged. No register is asked here: the profile was
 * set up from one.
 */
export async function linkClientCompany(input: {
  companyId: number;
  country: "SK" | "CZ";
  ico: string;
  legalName: string;
  address: string;
  dic: string;
  icDph: string;
  now: string;
}): Promise<SubjectRow | null> {
  const ico = compact(input.ico);
  if (!/^\d{8}$/.test(ico)) {
    await unlinkCompanySubjectsExcept(input.companyId, -1);
    return null;
  }
  let subject = await findSubjectByIco(input.country, ico);
  if (!subject) {
    const vat = input.country === "SK" ? input.icDph : input.dic;
    subject = await insertSubject({
      country: input.country,
      ico,
      vatId: compact(vat).toUpperCase() || null,
      legalName: input.legalName,
      dic: input.dic || null,
      icDph: input.icDph || null,
      address: input.address || null,
      sources: { legalName: "profile", dic: input.dic ? "profile" : undefined, address: "profile" },
      now: input.now,
    });
  }
  return linkSubject(subject, { companyId: input.companyId, legalName: input.legalName, dic: input.dic }, input.now);
}

/** Her correction of a subject's field (ADR 0022): kept over every register refresh. */
export async function correctSubjectField(
  subjectId: number,
  field: SubjectField,
  value: string | null,
  now: string,
): Promise<SubjectRow | null> {
  if (field === "vatGroupId") {
    return setSubjectVatGroup(subjectId, value);
  }
  const subject = await getSubject(subjectId);
  if (!subject) {
    return null;
  }
  return updateSubject(subjectId, correctField(stateOf(subject), field, value, now) as SubjectPatch);
}
