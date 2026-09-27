import { getCompanyById } from "@/adapters/store/companies";
import { getCompanyProfile } from "@/adapters/store/company-profiles";
import { homeCurrencyForCountry } from "@/modules/company-profile";
import { listFilesForMonth } from "@/adapters/store/files";
import {
  ensureDocumentsForMonth,
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
  driveFileId: string;
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
  extractionSource: EkasaExtractionSource | "model" | "ocr" | null;
  showUidBox: boolean;
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

export function buildMonthDocumentView(
  companyId: number,
  monthKey: string,
  folderFilter?: string | null,
): MonthDocumentView | null {
  const company = getCompanyById(companyId);
  if (!company) {
    return null;
  }

  const month = getMonthByKey(companyId, monthKey);
  if (!month) {
    return null;
  }

  const now = new Date().toISOString();
  ensureDocumentsForMonth(companyId, monthKey, now);

  const companyProfile = getCompanyProfile(companyId);
  const homeCurrency = homeCurrencyForCountry(companyProfile?.country ?? "SK");

  const files = listFilesForMonth(companyId, monthKey);
  const fileById = new Map(files.map((file) => [file.driveFileId, file]));
  const documentRows = listDocumentsForMonth(companyId, monthKey);
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
        driveFileId: document.driveFileId,
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
          !hasEkasaLookupPayload(payload),
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

  const openMonthKey = getOpenMonthKey(companyId);

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
