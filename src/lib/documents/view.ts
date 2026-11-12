import { getCompanyById } from "@/adapters/store/companies";
import { getCompanyProfile } from "@/adapters/store/company-profiles";
import { homeCurrencyForCountry } from "@/modules/company-profile";
import { getFileByDriveId, listFilesForMonth } from "@/adapters/store/files";
import { receiptUidOfDocument } from "@/modules/receipt-identity";
import {
  ensureDocumentsForMonth,
  listDocumentsForCompany,
  listDocumentsForMonth,
} from "@/adapters/store/documents";
import { getMonthByKey, getOpenMonthKey } from "@/adapters/store/months";
import {
  deriveDocumentStatus,
  deriveReceiptKind,
  isProcessedFolderSlot,
  type DerivedDocumentStatus,
  type ProcessedFolderSlot,
} from "@/modules/document-state";
import {
  checkArithmeticWarning,
  effectiveAmountDisplay,
  enrichmentEnabledFor,
  type EditableDocumentFields,
  type FieldProvenanceMap,
} from "@/modules/document-fields";
import type { DirectoryFactsByKey } from "@/modules/party-enrichment";
import {
  mergeDocumentFieldsWithDirectory,
  type DirectoryFactsCache,
} from "@/lib/subject-directory/directory-facts";
import {
  editorFieldChecksFromModel,
  withoutArithmeticChecks,
  type EditorScalarFieldChecks,
} from "@/modules/editor-field-checks";
import {
  getTypedEkasaUid,
  hasEkasaLookupPayload,
  isEkasaPayload,
  isModelExtractedPayload,
  parseConfirmedPayload,
  parseExtractedPayload,
  type EkasaExtractionSource,
} from "@/modules/document-payload";
import { folderSlotPrefix, formatDate, formatDateTime } from "@/modules/format-sk";
import {
  hasSubjectProblem,
  sortDocuments,
  type DocumentSortDirection,
  type DocumentSortKey,
} from "@/modules/document-browser";
import { companyDisplayName } from "@/modules/company-display-name";
import type { CompanyProfileFields, HomeCurrency } from "@/modules/company-profile";
import type {
  AdvanceSettlementPayload,
  DocTypeHint,
  ExtractedPayload,
  ConfirmedPayload,
} from "@/modules/document-payload";
import { withoutPartyChecks } from "@/modules/party-swap";
import type { ClientIdentity } from "@/modules/party-roles";
import {
  checkDocumentParties,
  clientIdentityOf,
  parsePartyIntegrityRecord,
  partyIdentityKey,
  type SubjectCheck,
} from "@/modules/subject-integrity";
import {
  readExportSectionOverride,
  resolveExportSection,
  type ExportSectionOverride,
  type OmegaExportSection,
} from "@/modules/omega-export-section";

export type DocumentFieldEditorView = {
  fields: EditableDocumentFields;
  provenance: FieldProvenanceMap;
  fieldChecks: EditorScalarFieldChecks | null;
  docTypeHint: DocTypeHint | null;
  arithmeticWarning: string | null;
  vatWarnings: string[];
  nonEurCurrency: boolean;
  homeCurrency: HomeCurrency;
  profileCountry: "SK" | "CZ" | null;
  rolesFlagged: boolean;
  missingProfile: boolean;
  /** Settled by an advance: the amount is the supply, and VAT is never inferred from it. Absent reads as false. */
  advanceSettled?: boolean;
  /** The settlement in effect — detected, or hers over it. Null when the invoice is not settled. */
  advanceSettlement?: AdvanceSettlementPayload | null;
  /** Her decision on the settlement, when she has made one: true settled, false not settled. */
  advanceSettlementOverride?: boolean | null;
  /** Whether she can mark the invoice settled or not: it was read as an invoice. */
  advanceSettlementAvailable?: boolean;
  /** What the panel needs to judge the roles again after she swaps the parties. */
  roleContext: {
    profile: ClientIdentity | null;
    enrichmentEnabled: boolean;
    /** The directory's facts for both parties' subjects, by key: a swap keeps the keys (ADR 0022). */
    directory: DirectoryFactsByKey;
  };
  /**
   * The subject-integrity verdict of each party: the worker's stored verdict
   * when it was judged for these values, else the offline checks (ADR 0022).
   */
  partyIntegrity: { supplier: SubjectCheck; customer: SubjectCheck };
  /** Whether partyIntegrity is the worker's stored verdict (with the registers) rather than offline. */
  partyIntegrityStored: boolean;
  /** The identity the verdict was judged for, as the fields panel compares it with her draft. */
  partyIntegrityIdentity: string;
  exportSectionOverride: ExportSectionOverride;
  exportSectionResolved: OmegaExportSection;
};

export type DocumentListItem = {
  /** The document's own ID — what decisions, fields and export key on. */
  id: string;
  /** The file it was read from — what the preview shows. */
  driveFileId: string;
  /** Its place among the receipts of one scan; null for a file with one document. */
  receiptOfFile: { index: number; count: number } | null;
  /** Other documents holding the same eKasa receipt, which must be booked once. */
  sameReceiptAs: Array<{ id: string; fileName: string; monthKey: string }>;
  name: string;
  folderSlot: ProcessedFolderSlot;
  mimeType: string;
  receiptKind: "receipt" | null;
  decision: "confirmed" | "not_relevant" | null;
  decidedAt: string | null;
  notRelevantReason: string | null;
  note: string | null;
  label: string;
  amountDisplay: string;
  receiptDisplay: string;
  issueDateDisplay: string;
  /** When the file was created in Drive: the date the list shows until the document's own is read. */
  fileDateDisplay: string;
  derivedStatus: DerivedDocumentStatus;
  extractionFailureReason: string | null;
  hasExtractedData: boolean;
  extractionSource: EkasaExtractionSource | "model" | "ocr" | "isdoc" | "mol" | null;
  showUidBox: boolean;
  /** A receipt that is not from eKasa (a parking machine's ticket): read from the document, no UID. */
  outsideEkasa: boolean;
  /** Whether she may have the file read again (requestDocumentReextraction): open, undecided, not being read. */
  canReextract: boolean;
  typedEkasaUid: string | null;
  fieldEditor: DocumentFieldEditorView;
};

/** A document whose party failed integrity, named for the export warning. */
export type SubjectProblemDocument = {
  id: string;
  label: string;
  name: string;
  folderSlot: string;
};

export type FolderFilterOption = {
  slot: string;
  /** `02` — the compact chip label; the full name is the tooltip. */
  shortLabel: string;
  count: number;
};

export type ReadOnlyFile = {
  driveFileId: string;
  name: string;
};

export type MonthDocumentView = {
  companyName: string;
  monthKey: string;
  readOnly: boolean;
  isOpenMonth: boolean;
  /** Month-wide, never affected by the folder filter — this is what reaches zero. */
  awaitingCount: number;
  decidedCount: number;
  totalCount: number;
  /**
   * Documents whose parser has not finished, month-wide. Extraction is kicked
   * off in the background when a month (or the chase list) is opened, so the
   * screen has to know when it is still running.
   */
  pendingExtractionCount: number;
  folderFilter: string | null;
  sortKey: DocumentSortKey;
  sortDirection: DocumentSortDirection;
  /** The company's home currency, as the rail's price sort groups by it. */
  homeCurrency: HomeCurrency;
  folderFilters: FolderFilterOption[];
  documents: DocumentListItem[];
  /**
   * Documents with a party whose verdict is a mismatch, month-wide and never
   * affected by the folder filter: the export warns about them. Dismissed
   * documents are not listed, since the export never sends them.
   */
  subjectProblems: SubjectProblemDocument[];
  /**
   * Files at the month root with no folder slot — Omega's VAT outputs. Never
   * documents, never decided, shown so they are not invisible (ADR 0013).
   */
  readOnlyFiles: ReadOnlyFile[];
};

/**
 * The field checks the extraction made, with her party decisions and her
 * settlement decision applied: a swap drops the party checks, and a settlement
 * decision drops the arithmetic verdicts (the panel judges them live).
 */
function editorChecksOf(input: {
  payload: ExtractedPayload;
  confirmed: ConfirmedPayload;
  folderSlot: string;
  profile: CompanyProfileFields | null;
}): EditorScalarFieldChecks | null {
  if (!isModelExtractedPayload(input.payload)) {
    return null;
  }
  const checks = editorFieldChecksFromModel({
    extracted: input.payload,
    folderSlot: input.folderSlot,
    profile: input.profile,
  });
  const partiesChecked = input.confirmed.partyProvenance !== undefined ? withoutPartyChecks(checks) : checks;
  if (partiesChecked === null || input.confirmed.advanceSettlement === undefined) {
    return partiesChecked;
  }
  return withoutArithmeticChecks(partiesChecked);
}

/** Her company as the panel judges roles; no address, which roles never read. */
function roleContextOf(profile: CompanyProfileFields | null): ClientIdentity | null {
  return clientIdentityOf(profile);
}

/**
 * The verdict a page shows: the worker's stored one when it was judged for
 * exactly these values and this profile; otherwise the offline checks, which
 * the worker will replace. Pages never call a register (ADR 0022).
 */
function partyIntegrityOf(input: {
  storedJson: string | null;
  folderSlot: string;
  fields: EditableDocumentFields;
  profile: ClientIdentity | null;
}): Pick<DocumentFieldEditorView, "partyIntegrity" | "partyIntegrityStored" | "partyIntegrityIdentity"> {
  const identity = partyIdentityKey(input.fields, input.profile);
  const stored = parsePartyIntegrityRecord(input.storedJson);
  if (stored && stored.identity === identity) {
    return {
      partyIntegrity: { supplier: stored.supplier, customer: stored.customer },
      partyIntegrityStored: true,
      partyIntegrityIdentity: identity,
    };
  }
  return {
    partyIntegrity: checkDocumentParties({
      folderSlot: input.folderSlot,
      fields: input.fields,
      profile: input.profile,
    }),
    partyIntegrityStored: false,
    partyIntegrityIdentity: identity,
  };
}

function formatReceiptAt(receiptAt: string | null): string {
  return formatDateTime(receiptAt);
}

function receiptPosition(
  idsOfFile: readonly string[],
  documentId: string,
): { index: number; count: number } | null {
  if (idsOfFile.length < 2) {
    return null;
  }
  return { index: idsOfFile.indexOf(documentId) + 1, count: idsOfFile.length };
}

function documentLabel(
  name: string,
  fields: EditableDocumentFields,
): string {
  if (fields.supplierName) {
    return fields.supplierName;
  }
  if (fields.customerName) {
    return fields.customerName;
  }
  return name;
}

export async function buildMonthDocumentView(
  companyId: number,
  monthKey: string,
  folderFilter?: string | null,
  sort?: { key: DocumentSortKey; direction: DocumentSortDirection },
): Promise<MonthDocumentView | null> {
  const company = await getCompanyById(companyId);
  if (!company) {
    return null;
  }

  const month = await getMonthByKey(companyId, monthKey);
  if (!month) {
    return null;
  }

  const now = new Date().toISOString();
  await ensureDocumentsForMonth(companyId, monthKey, now);

  const [companyProfile, files, documentRows, companyDocuments, openMonthKey] = await Promise.all([
    getCompanyProfile(companyId),
    listFilesForMonth(companyId, monthKey),
    listDocumentsForMonth(companyId, monthKey),
    listDocumentsForCompany(companyId),
    getOpenMonthKey(companyId),
  ]);
  const homeCurrency = homeCurrencyForCountry(companyProfile?.country ?? "SK");
  const fileById = new Map(files.map((file) => [file.driveFileId, file]));

  // A scan of several receipts: the file's own document first, then the rest.
  const documentsByFile = new Map<string, string[]>();
  for (const document of documentRows) {
    documentsByFile.set(document.driveFileId, [...(documentsByFile.get(document.driveFileId) ?? []), document.id]);
  }
  for (const [driveFileId, ids] of documentsByFile) {
    ids.sort((left, right) => (left === driveFileId ? -1 : right === driveFileId ? 1 : left.localeCompare(right)));
  }
  // The same receipt anywhere in the company's documents, in any month.
  const documentsByUid = new Map<string, Array<{ id: string; driveFileId: string; monthKey: string }>>();
  for (const document of companyDocuments) {
    const uid = receiptUidOfDocument(document);
    if (uid) {
      documentsByUid.set(uid, [...(documentsByUid.get(uid) ?? []), document]);
    }
  }
  // Names of the other months' files a receipt here is also in.
  const otherFileIds = new Set<string>();
  for (const document of documentRows) {
    for (const other of documentsByUid.get(receiptUidOfDocument(document) ?? "") ?? []) {
      if (other.id !== document.id && !fileById.has(other.driveFileId)) {
        otherFileIds.add(other.driveFileId);
      }
    }
  }
  const otherFileNames = new Map(
    (await Promise.all([...otherFileIds].map((driveFileId) => getFileByDriveId(driveFileId))))
      .filter((file) => file !== undefined)
      .map((file) => [file.driveFileId, file.name]),
  );
  const monthReadOnly = month.closedAt !== null;

  // A file with anything decided or exported is not read again.
  const settledFiles = new Set(
    documentRows
      .filter((document) => document.decision !== null || document.exportedAt !== null)
      .map((document) => document.driveFileId),
  );
  // What the directory fills for a missing party value: read from its rows, never from a register (ADR 0022).
  const directoryCache: DirectoryFactsCache = new Map();
  const mergedByDocument = new Map<string, Awaited<ReturnType<typeof mergeDocumentFieldsWithDirectory>>>();
  for (const document of documentRows) {
    const file = fileById.get(document.driveFileId);
    if (!file || file.deleted) {
      continue;
    }
    const folderSlot = file.folderSlot ?? document.folderSlot;
    if (!isProcessedFolderSlot(folderSlot)) {
      continue;
    }
    mergedByDocument.set(
      document.id,
      await mergeDocumentFieldsWithDirectory(
        parseExtractedPayload(document.extractedPayloadJson),
        parseConfirmedPayload(document.confirmedPayloadJson),
        {
          folderSlot,
          profile: companyProfile,
          homeCurrency,
          extractionPipelineVersion: document.extractionPipelineVersion,
        },
        directoryCache,
      ),
    );
  }

  const documentItems = documentRows
    .map((document): DocumentListItem | null => {
      const file = fileById.get(document.driveFileId);
      if (!file || file.deleted) {
        return null;
      }

      const folderSlot = file.folderSlot ?? document.folderSlot;
      if (!isProcessedFolderSlot(folderSlot)) {
        return null;
      }

      const payload = parseExtractedPayload(document.extractedPayloadJson);
      const confirmed = parseConfirmedPayload(document.confirmedPayloadJson);
      const { merged, directory } = mergedByDocument.get(document.id)!;
      const amountDisplay = effectiveAmountDisplay(merged.fields);
      const receiptDisplay = formatReceiptAt(
        merged.fields.issueDateAt ?? merged.fields.receiptAt,
      );
      const issueDateDisplay = formatDate(merged.fields.issueDateAt);

      return {
        id: document.id,
        driveFileId: document.driveFileId,
        receiptOfFile: receiptPosition(documentsByFile.get(document.driveFileId) ?? [], document.id),
        sameReceiptAs: (documentsByUid.get(receiptUidOfDocument(document) ?? "") ?? [])
          .filter((other) => other.id !== document.id)
          .map((other) => ({
            id: other.id,
            fileName: fileById.get(other.driveFileId)?.name ?? otherFileNames.get(other.driveFileId) ?? other.driveFileId,
            monthKey: other.monthKey,
          })),
        name: file.name,
        folderSlot,
        mimeType: file.mimeType,
        receiptKind: deriveReceiptKind(folderSlot),
        decision:
          document.decision === "confirmed" || document.decision === "not_relevant"
            ? document.decision
            : null,
        decidedAt: document.decidedAt,
        notRelevantReason: document.notRelevantReason,
        note: document.note,
        label: documentLabel(file.name, merged.fields),
        amountDisplay,
        receiptDisplay,
        issueDateDisplay,
        fileDateDisplay: formatDate(file.driveCreatedTime),
        derivedStatus: deriveDocumentStatus({
          decision: document.decision,
          extractionStatus: document.extractionStatus,
          extractionFailureReason: document.extractionFailureReason,
          folderSlot,
          mimeType: file.mimeType,
        }),
        extractionFailureReason: document.extractionFailureReason,
        hasExtractedData: isEkasaPayload(payload) || isModelExtractedPayload(payload),
        extractionSource: isEkasaPayload(payload)
          ? (payload.source ?? null)
          : isModelExtractedPayload(payload)
            ? (payload.source ?? null)
            : null,
        showUidBox:
          !monthReadOnly &&
          deriveReceiptKind(folderSlot) !== null &&
          !hasEkasaLookupPayload(payload) &&
          !(isModelExtractedPayload(payload) && payload.outsideEkasa === true),
        outsideEkasa: isModelExtractedPayload(payload) && payload.outsideEkasa === true,
        canReextract:
          !monthReadOnly &&
          !settledFiles.has(document.driveFileId) &&
          document.extractionStatus !== "pending",
        typedEkasaUid: getTypedEkasaUid(payload),
        fieldEditor: {
          fields: merged.fields,
          provenance: merged.provenance,
          fieldChecks: editorChecksOf({
            payload,
            confirmed,
            folderSlot,
            profile: companyProfile,
          }),
          docTypeHint: isModelExtractedPayload(payload) ? payload.docTypeHint : null,
          arithmeticWarning: checkArithmeticWarning(merged.fields),
          vatWarnings: merged.vatWarnings ?? [],
          nonEurCurrency: merged.nonEurCurrency,
          homeCurrency,
          profileCountry: companyProfile?.country ?? null,
          rolesFlagged: merged.rolesFlagged,
          missingProfile: merged.missingProfile,
          advanceSettled: merged.advanceSettled,
          advanceSettlement: merged.advanceSettlement,
          advanceSettlementOverride: confirmed.advanceSettlement?.settled ?? null,
          advanceSettlementAvailable: isModelExtractedPayload(payload),
          roleContext: {
            profile: roleContextOf(companyProfile),
            enrichmentEnabled: enrichmentEnabledFor(document.extractionPipelineVersion),
            directory,
          },
          ...partyIntegrityOf({
            storedJson: document.partyIntegrityJson,
            folderSlot,
            fields: merged.fields,
            profile: roleContextOf(companyProfile),
          }),
          exportSectionOverride: readExportSectionOverride(confirmed),
          exportSectionResolved: resolveExportSection({
            extracted: payload,
            confirmed,
            folderSlot,
          }),
        },
      };
    })
    .filter((item): item is DocumentListItem => item !== null);

  // A scan's further receipts are created after other files' documents; keep
  // them next to the file's own document, in their order within the file.
  const fileOrder = new Map<string, number>();
  documentItems.forEach((item, index) => {
    if (!fileOrder.has(item.driveFileId)) {
      fileOrder.set(item.driveFileId, index);
    }
  });
  documentItems.sort(
    (left, right) =>
      fileOrder.get(left.driveFileId)! - fileOrder.get(right.driveFileId)! ||
      (left.receiptOfFile?.index ?? 0) - (right.receiptOfFile?.index ?? 0),
  );

  const sortKey = sort?.key ?? "issueDate";
  const sortDirection = sort?.direction ?? "desc";
  const sortedDocumentItems = sortDocuments(
    documentItems,
    sortKey,
    sortDirection,
    homeCurrency,
  );

  const awaitingCount = documentItems.filter(
    (item) => item.decision === null,
  ).length;

  const countsBySlot = new Map<string, number>();
  for (const item of documentItems) {
    countsBySlot.set(item.folderSlot, (countsBySlot.get(item.folderSlot) ?? 0) + 1);
  }

  const folderFilters: FolderFilterOption[] = [...countsBySlot.entries()]
    .map(([slot, count]) => ({
      slot,
      shortLabel: folderSlotPrefix(slot),
      count,
    }))
    .sort((left, right) => left.slot.localeCompare(right.slot, "sk"));

  const readOnlyFiles: ReadOnlyFile[] = files
    .filter((file) => !file.deleted && file.folderSlot === null)
    .map((file) => ({ driveFileId: file.driveFileId, name: file.name }))
    .sort((left, right) => left.name.localeCompare(right.name, "sk"));

  return {
    companyName: companyDisplayName(company.name),
    monthKey,
    readOnly: monthReadOnly,
    isOpenMonth: openMonthKey === monthKey,
    awaitingCount,
    pendingExtractionCount: documentItems.filter(
      (item) => item.derivedStatus.kind === "pending-extraction",
    ).length,
    decidedCount: documentItems.length - awaitingCount,
    totalCount: documentItems.length,
    folderFilter: folderFilter ?? null,
    folderFilters,
    sortKey,
    sortDirection,
    homeCurrency,
    subjectProblems: sortedDocumentItems
      .filter((item) => item.decision !== "not_relevant" && hasSubjectProblem(item))
      .map((item) => ({ id: item.id, label: item.label, name: item.name, folderSlot: item.folderSlot })),
    documents: sortedDocumentItems.filter(
      (item) => !folderFilter || item.folderSlot === folderFilter,
    ),
    readOnlyFiles,
  };
}
