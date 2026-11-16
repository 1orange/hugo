import type { SubjectVerificationQueue } from "@/adapters/job-queue/port";
import { getCompanyProfile } from "@/adapters/store/company-profiles";
import { getSettings } from "@/adapters/store/settings";
import { getSubjectLinkedTo, listAllSubjects } from "@/adapters/store/subjects";
import { isStale } from "@/modules/subject-directory";
import {
  getDocument,
  listDocumentsForFile,
  listDocumentsForMonth,
  type DocumentRow,
} from "@/adapters/store/documents";
import type { CompanyProfileFields } from "@/modules/company-profile";
import { parsePartyIntegrityRecord, type PartyIntegrityRecord } from "@/modules/subject-integrity";
import { subjectVerificationQueue } from "./queue";
import { partyIdentityOf } from "./verify-document";

/** A verdict that said "unavailable" is asked again after this, when the document is next looked at. */
export const RETRY_UNAVAILABLE_MS = 10 * 60_000;

async function queueDocument(
  document: DocumentRow,
  queue: SubjectVerificationQueue,
  now: string,
): Promise<boolean> {
  return queue.add({
    documentId: document.id,
    companyId: document.companyId,
    monthKey: document.monthKey,
    driveFileId: document.driveFileId,
    enqueuedAt: now,
  });
}

/** After an identity edit: the document's verdict is no longer current. */
export async function queueSubjectCheckForDocument(
  documentId: string,
  queue: SubjectVerificationQueue = subjectVerificationQueue(),
  now: string = new Date().toISOString(),
): Promise<boolean> {
  const document = await getDocument(documentId);
  return document ? queueDocument(document, queue, now) : false;
}

/** After extraction: every document read out of the file (a scan may hold several receipts). */
export async function queueSubjectChecksForFile(
  driveFileId: string,
  queue: SubjectVerificationQueue = subjectVerificationQueue(),
  now: string = new Date().toISOString(),
): Promise<number> {
  let queued = 0;
  for (const document of await listDocumentsForFile(driveFileId)) {
    if (await queueDocument(document, queue, now)) {
      queued += 1;
    }
  }
  return queued;
}

/**
 * A page render for a month, open or closed: the documents read but not yet
 * checked are queued. Never throws: a page must not fail because Redis did.
 */
export async function scheduleSubjectChecksForMonth(companyId: number, monthKey: string): Promise<void> {
  try {
    await queueSubjectChecksForMonth(companyId, monthKey);
  } catch (error) {
    console.warn(`[subject] could not queue the party checks for ${companyId}/${monthKey}`, error);
  }
  await scheduleStaleClientSubjectCheck(companyId);
}

/** One client's subject, queued for its register and VIES check (0006/03). */
export async function queueClientSubjectCheck(
  subjectId: number,
  queue: SubjectVerificationQueue = subjectVerificationQueue(),
  now: string = new Date().toISOString(),
): Promise<boolean> {
  return queue.addClientSubject({ subjectId, enqueuedAt: now });
}

/**
 * After a change to a client's subject (a save, an import, a correction): it is checked
 * against the registers now, since what it holds has just changed. Never throws: saving
 * must not fail because Redis did.
 */
export async function scheduleClientSubjectCheckForSubject(subjectId: number): Promise<void> {
  try {
    await queueClientSubjectCheck(subjectId);
  } catch (error) {
    console.warn(`[subject] could not queue the client check for subject ${subjectId}`, error);
  }
}

/** After a profile save or a client sheet import: the company's subject is checked. Never throws. */
export async function scheduleClientSubjectCheck(companyId: number): Promise<void> {
  try {
    const subject = await getSubjectLinkedTo(companyId);
    if (subject) {
      await queueClientSubjectCheck(subject.id);
    }
  } catch (error) {
    console.warn(`[subject] could not queue the client check for company ${companyId}`, error);
  }
}

/**
 * When a client's page or month is looked at: its subject is checked again once its
 * register answer is as old as the refresh age, or never came (ADR 0022). A foreign
 * subject, or one with no IČO, has no register to ask. Never throws.
 */
export async function scheduleStaleClientSubjectCheck(companyId: number): Promise<void> {
  try {
    const subject = await getSubjectLinkedTo(companyId);
    if (!subject || subject.country === "foreign" || subject.ico === null) {
      return;
    }
    const { subjectRefreshDays } = await getSettings();
    if (isStale(subject.verifiedAt, new Date().toISOString(), subjectRefreshDays)) {
      await queueClientSubjectCheck(subject.id);
    }
  } catch (error) {
    console.warn(`[subject] could not queue the stale client check for company ${companyId}`, error);
  }
}

/**
 * When the Adresár is looked at: its office clients (0006/04) whose register answer is as old as the
 * refresh age, or never came, are checked again. A client's company page does this for a linked
 * client; an office client has no page, so the list does it. Never throws.
 */
export async function scheduleStaleOfficeClientChecks(): Promise<void> {
  try {
    const { subjectRefreshDays } = await getSettings();
    const now = new Date().toISOString();
    for (const subject of await listAllSubjects()) {
      if (
        subject.officeClient &&
        subject.linkedCompanyId === null &&
        subject.country !== "foreign" &&
        subject.ico !== null &&
        isStale(subject.verifiedAt, now, subjectRefreshDays)
      ) {
        await queueClientSubjectCheck(subject.id);
      }
    }
  } catch (error) {
    console.warn("[subject] could not queue the stale office client checks", error);
  }
}

/**
 * When a month is looked at: the documents read but not yet checked, checked
 * against an earlier identity, or whose last check could not reach a register.
 * Existing documents are verified this way, lazily (ADR 0022).
 */
export async function queueSubjectChecksForMonth(
  companyId: number,
  monthKey: string,
  queue: SubjectVerificationQueue = subjectVerificationQueue(),
  now: string = new Date().toISOString(),
): Promise<number> {
  const profile = await getCompanyProfile(companyId);
  let queued = 0;
  for (const document of await listDocumentsForMonth(companyId, monthKey)) {
    if (document.extractionStatus !== "complete" || document.exportedAt !== null) {
      continue;
    }
    if (!(await needsCheck(document, profile, now))) {
      continue;
    }
    if (await queueDocument(document, queue, now)) {
      queued += 1;
    }
  }
  return queued;
}

/**
 * A verdict still waiting for an answer: a register or VIES that did not answer, or a VAT
 * group the subject is not yet recorded in (the accountant may record it, and the
 * verdict then needs judging again).
 */
function awaitingAnswer(record: PartyIntegrityRecord): boolean {
  return [record.supplier, record.customer].some(
    (check) =>
      check.verdict === "unavailable" ||
      check.findings.some((item) => item.code === "vies-unavailable" || item.code === "vat-group-unconfirmed"),
  );
}

async function needsCheck(document: DocumentRow, profile: CompanyProfileFields | null, now: string): Promise<boolean> {
  const record = parsePartyIntegrityRecord(document.partyIntegrityJson);
  if (!record) {
    return true;
  }
  if (record.identity !== (await partyIdentityOf(document, profile))) {
    return true;
  }
  return awaitingAnswer(record) && Date.parse(now) - Date.parse(record.checkedAt) >= RETRY_UNAVAILABLE_MS;
}

/**
 * After she confirms a document: its party check is queued, so that a VAT-group membership
 * the document shows is recorded (PRD 0004, story 33). Never throws: confirming must not fail
 * because Redis did.
 */
export async function scheduleSubjectCheckForDocument(documentId: string): Promise<void> {
  try {
    await queueSubjectCheckForDocument(documentId);
  } catch (error) {
    console.warn(`[subject] could not queue the party check for ${documentId}`, error);
  }
}
