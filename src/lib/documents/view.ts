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
  mergeDocumentFields,
  type EditableDocumentFields,
  type FieldProvenanceMap,
} from "@/modules/document-fields";
import {
  editorFieldChecksFromModel,
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
import { folderSlotPrefix, formatDateTime } from "@/modules/format-sk";
import type { HomeCurrency } from "@/modules/company-profile";
import type { DocTypeHint } from "@/modules/document-payload";
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
  nonEurCurrency: boolean;
  homeCurrency: HomeCurrency;
  rolesFlagged: boolean;
  missingProfile: boolean;
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
  receiptKind: "cash" | "card" | null;
  decision: "confirmed" | "not_relevant" | null;
  decidedAt: string | null;
  notRelevantReason: string | null;
  note: string | null;
  label: string;
  amountDisplay: string;
  receiptDisplay: string;
  derivedStatus: DerivedDocumentStatus;
  extractionFailureReason: string | null;
  hasExtractedData: boolean;
  extractionSource: EkasaExtractionSource | "model" | "ocr" | "isdoc" | "mol" | null;
  showUidBox: boolean;
  /** A receipt that is not from eKasa (a parking machine's ticket): read from the document, no UID. */
  outsideEkasa: boolean;
  typedEkasaUid: string | null;
  fieldEditor: DocumentFieldEditorView;
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
  folderFilters: FolderFilterOption[];
  documents: DocumentListItem[];
  /**
   * Files at the month root with no folder slot — Omega's VAT outputs. Never
   * documents, never decided, shown so they are not invisible (ADR 0013).
   */
  readOnlyFiles: ReadOnlyFile[];
};

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

  const documentItems = documentRows
    .map((document) => {
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
      const merged = mergeDocumentFields(payload, confirmed, {
        folderSlot,
        profile: companyProfile,
        homeCurrency,
      });
      const amountDisplay = effectiveAmountDisplay(merged.fields);
      const receiptDisplay = formatReceiptAt(
        merged.fields.issueDateAt ?? merged.fields.receiptAt,
      );

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
        typedEkasaUid: getTypedEkasaUid(payload),
        fieldEditor: {
          fields: merged.fields,
          provenance: merged.provenance,
          fieldChecks: isModelExtractedPayload(payload)
            ? editorFieldChecksFromModel({
                extracted: payload,
                folderSlot,
                profile: companyProfile,
              })
            : null,
          docTypeHint: isModelExtractedPayload(payload) ? payload.docTypeHint : null,
          arithmeticWarning: checkArithmeticWarning(merged.fields),
          nonEurCurrency: merged.nonEurCurrency,
          homeCurrency,
          rolesFlagged: merged.rolesFlagged,
          missingProfile: merged.missingProfile,
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
    .map((file) => ({ driveFileId: file.driveFileId, name: file.name }));

  return {
    companyName: company.name,
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
    documents: documentItems.filter(
      (item) => !folderFilter || item.folderSlot === folderFilter,
    ),
    readOnlyFiles,
  };
}
