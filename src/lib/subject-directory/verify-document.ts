import { getCompanyProfile } from "@/adapters/store/company-profiles";
import { getDocument, writePartyIntegrity, type DocumentRow } from "@/adapters/store/documents";
import { getFileByDriveId } from "@/adapters/store/files";
import { announce } from "@/lib/events/bus";
import { homeCurrencyForCountry, type CompanyProfileFields } from "@/modules/company-profile";
import type { EditableDocumentFields } from "@/modules/document-fields";
import { parseConfirmedPayload, parseExtractedPayload } from "@/modules/document-payload";
import type { PartyIdentity } from "@/modules/party-roles";
import {
  checkBothParties,
  clientIdentityOf,
  clientSideOf,
  partyIdentityKey,
  type CounterpartyEvidence,
  type PartyIntegrityRecord,
} from "@/modules/subject-integrity";
import { mergeDocumentFieldsWithDirectory } from "./directory-facts";
import {
  recordGroupMembershipOf,
  verifyCounterparty,
  type DirectoryDeps,
} from "./service";

/**
 * The worker's party check of one document (ADR 0018 amendment, ADR 0022): the
 * client's party against her profile, each counterparty against the subject
 * directory, and the verdicts stored on the document for the pages to read.
 */

/**
 * The document's values as the screens show them: merged, her corrections
 * included, and with what the subject directory fills for a missing value.
 */
export async function mergedPartyFieldsOf(
  document: DocumentRow,
  profile: CompanyProfileFields | null,
): Promise<EditableDocumentFields> {
  const { merged } = await mergeDocumentFieldsWithDirectory(
    parseExtractedPayload(document.extractedPayloadJson),
    parseConfirmedPayload(document.confirmedPayloadJson),
    {
      folderSlot: document.folderSlot,
      profile,
      homeCurrency: homeCurrencyForCountry(profile?.country ?? "SK"),
      extractionPipelineVersion: document.extractionPipelineVersion,
    },
  );
  return merged.fields;
}

/** The identity the stored verdict of this document is judged for, from its current values. */
export async function partyIdentityOf(
  document: DocumentRow,
  profile: CompanyProfileFields | null,
): Promise<string> {
  return partyIdentityKey(await mergedPartyFieldsOf(document, profile), clientIdentityOf(profile));
}

function partiesOf(fields: EditableDocumentFields): { supplier: PartyIdentity; customer: PartyIdentity } {
  return {
    supplier: { name: fields.supplierName, ico: fields.ico, dic: fields.dic, icDph: fields.icDph },
    customer: { name: fields.customerName, ico: fields.customerIco, dic: fields.customerDic, icDph: fields.customerIcDph },
  };
}

function hasIdentifiers(party: PartyIdentity): boolean {
  return [party.name, party.ico, party.dic, party.icDph].some((value) => value.trim().length > 0);
}

/**
 * What the directory knows of a counterparty. A confirmed document also records the
 * subject's VAT-group membership when it shows one (PRD 0004, story 33).
 */
async function evidenceFor(
  party: PartyIdentity,
  deps: DirectoryDeps,
  confirmed: boolean,
  documentId: string,
): Promise<CounterpartyEvidence | undefined> {
  if (!hasIdentifiers(party)) {
    return undefined;
  }
  let check = await verifyCounterparty(party, deps, { documentId });
  if (confirmed) {
    check = await recordGroupMembershipOf(party, check, deps.now());
  }
  return { register: check.register, vies: check.vies, vatGroupId: check.vatGroupId };
}

/**
 * Checks one document's parties and stores the verdicts. Returns null when
 * there is nothing to check (no document, or its file is gone). Throws only
 * for what a retry can mend: a rate-limited lookup, or the database.
 */
export async function verifyDocumentParties(
  documentId: string,
  deps: DirectoryDeps,
): Promise<PartyIntegrityRecord | null> {
  const document = await getDocument(documentId);
  if (!document) {
    return null;
  }
  const file = await getFileByDriveId(document.driveFileId);
  if (!file || file.deleted) {
    return null;
  }

  const profile = await getCompanyProfile(document.companyId);
  const profileIdentity = clientIdentityOf(profile);
  const fields = await mergedPartyFieldsOf(document, profile);
  const { supplier, customer } = partiesOf(fields);
  const folderSlot = document.folderSlot;

  // Her own party is judged against her profile; the other side is looked up.
  const side = clientSideOf({ folderSlot, supplier, customer, profile: profileIdentity });
  const confirmed = document.decision === "confirmed";
  const evidence = {
    supplier: side === "supplier" ? undefined : await evidenceFor(supplier, deps, confirmed, document.id),
    customer: side === "customer" ? undefined : await evidenceFor(customer, deps, confirmed, document.id),
  };
  const checks = checkBothParties({ folderSlot, supplier, customer, profile: profileIdentity, evidence });

  const record: PartyIntegrityRecord = {
    identity: partyIdentityKey(fields, profileIdentity),
    checkedAt: deps.now(),
    supplier: checks.supplier,
    customer: checks.customer,
  };
  await writePartyIntegrity(document.id, JSON.stringify(record));
  announce({
    type: "document-checked",
    companyId: document.companyId,
    monthKey: document.monthKey,
    driveFileId: document.driveFileId,
  });
  return record;
}
