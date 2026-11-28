import { getSubject, updateSubject, type SubjectRow } from "@/adapters/store/subjects";
import type { RegisterLookup } from "@/modules/company-profile";
import {
  applyRegisterFacts,
  icDphConfirmedByVies,
  viesTargetOf,
  type SubjectCountry,
} from "@/modules/subject-directory";
import { factsOf, SubjectLookupDeferred, viesAnswerFor, type DirectoryDeps } from "./service";

/**
 * The register check of one client's subject (0006/03). A client's profile is its
 * subject, so its values are checked the way a counterparty's are: one lookup per key
 * across the replicas, through the same rate limit, and the answer kept by the rules
 * of subject-directory (a kept value that disagrees becomes a finding, not an overwrite).
 */

const LOCK_TTL_MS = 60_000;
const DEFAULT_WAIT_MS = 30_000;

/**
 * The register did not answer for the client's subject. Nothing is changed, and the
 * job is tried again, as a rate-limited lookup is: the field states stay as they were.
 */
export class ClientRegisterUnavailable extends Error {
  constructor(cause: unknown) {
    super(`Register teraz neodpovedá (${cause instanceof Error ? cause.message : String(cause)}).`);
    this.name = "ClientRegisterUnavailable";
  }
}

/**
 * Checks one client's subject: the register's answer for its IČO (RPO and RÚZ for SK,
 * ARES for CZ), then VIES for its IČ DPH. Asked on every call: the caller queues it after
 * a save, an import, or a stale answer, and the register is what says whether the values
 * hold. Null when the subject is gone.
 */
export async function verifyClientSubject(subjectId: number, deps: DirectoryDeps): Promise<SubjectRow | null> {
  const subject = await getSubject(subjectId);
  if (!subject) {
    return null;
  }
  const checked = subject.ico !== null && subject.country !== "foreign"
    ? await lookUpClientRegister(subject, deps)
    : subject;
  return checkClientVies(checked, deps);
}

async function lookUpClientRegister(
  subject: SubjectRow,
  deps: DirectoryDeps,
): Promise<SubjectRow> {
  const country = subject.country as Exclude<SubjectCountry, "foreign">;
  const ico = subject.ico!;
  const lockKey = `${country}:${ico}`;
  const token = await deps.lock.tryAcquire(lockKey, LOCK_TTL_MS);
  if (token === null) {
    // Another lookup of this subject is in flight: it stores the answer, and this one is not asked again.
    await deps.lock.waitUntilFree(lockKey, deps.waitMs ?? DEFAULT_WAIT_MS);
    return (await getSubject(subject.id)) ?? subject;
  }
  try {
    if (!deps.limiter.tryTake()) {
      throw new SubjectLookupDeferred(deps.limiter.msUntilFree());
    }
    let lookup: RegisterLookup | null;
    try {
      lookup = await deps.register.lookupByIco(ico, country, { withHistory: true });
    } catch (error) {
      throw new ClientRegisterUnavailable(error);
    }
    // Read again under the lock: the subject may have changed while this check waited.
    const current = (await getSubject(subject.id)) ?? subject;
    const now = deps.now();
    if (!lookup) {
      // Absent from the register: recorded as checked, with no answer for its fields.
      return (await updateSubject(current.id, { verifiedAt: now })) ?? current;
    }
    const update = applyRegisterFacts(current, factsOf(lookup), now);
    return (await updateSubject(current.id, update)) ?? current;
  } finally {
    await deps.lock.release(lockKey, token);
  }
}

async function checkClientVies(subject: SubjectRow, deps: DirectoryDeps): Promise<SubjectRow> {
  const party = {
    name: subject.legalName ?? "",
    ico: subject.ico ?? "",
    dic: subject.dic ?? "",
    icDph: subject.icDph ?? "",
  };
  const vatId = subject.icDph ? viesTargetOf(party, subject.country) : null;
  if (!vatId) {
    return subject;
  }
  const vies = await viesAnswerFor(subject, vatId, deps);
  const current = (await getSubject(subject.id)) ?? subject;
  const confirmed = icDphConfirmedByVies(current, vatId, vies);
  if (!confirmed) {
    return current;
  }
  return (await updateSubject(current.id, confirmed)) ?? current;
}
