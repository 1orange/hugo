import { getCompanyById } from "@/adapters/store/companies";
import { listFilesForMonth } from "@/adapters/store/files";
import {
  ensureDocumentsForMonth,
  listDocumentsForMonth,
} from "@/adapters/store/documents";
import { getMonthByKey, getOpenMonthKey } from "@/adapters/store/months";
import {
  countAwaitingDecision,
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
  isEkasaPayload,
  parseConfirmedPayload,
  parseExtractedPayload,
} from "@/modules/document-payload";

export type DocumentFieldEditorView = {
  fields: EditableDocumentFields;
  provenance: FieldProvenanceMap;
  arithmeticWarning: string | null;
  nonEurCurrency: boolean;
};

export type DocumentListItem = {
  driveFileId: string;
  name: string;
  folderSlot: ProcessedFolderSlot;
  mimeType: string;
  receiptKind: "cash" | "card" | null;
  decision: "confirmed" | "not_relevant" | null;
  notRelevantReason: string | null;
  note: string | null;
  label: string;
  amountDisplay: string;
  receiptDisplay: string;
  derivedStatus: DerivedDocumentStatus;
  extractionFailureReason: string | null;
  hasExtractedData: boolean;
  fieldEditor: DocumentFieldEditorView;
};

export type MonthDocumentView = {
  companyName: string;
  monthKey: string;
  readOnly: boolean;
  isOpenMonth: boolean;
  awaitingCount: number;
  folderFilter: string | null;
  documents: DocumentListItem[];
};

function formatReceiptAt(receiptAt: string | null): string {
  if (!receiptAt) {
    return "—";
  }
  return new Intl.DateTimeFormat("sk-SK", {
    timeZone: "Europe/Bratislava",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(receiptAt));
}

function documentLabel(
  name: string,
  fields: EditableDocumentFields,
): string {
  if (fields.supplierName) {
    return fields.supplierName;
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

  const files = listFilesForMonth(companyId, monthKey);
  const fileById = new Map(files.map((file) => [file.driveFileId, file]));
  const documentRows = listDocumentsForMonth(companyId, monthKey);

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
      const merged = mergeDocumentFields(payload, confirmed);
      const amountDisplay = effectiveAmountDisplay(merged.fields);
      const receiptDisplay = formatReceiptAt(merged.fields.receiptAt);

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
        }),
        extractionFailureReason: document.extractionFailureReason,
        hasExtractedData: isEkasaPayload(payload),
        fieldEditor: {
          fields: merged.fields,
          provenance: merged.provenance,
          arithmeticWarning: checkArithmeticWarning(merged.fields),
          nonEurCurrency: merged.nonEurCurrency,
        },
      };
    })
    .filter((item): item is DocumentListItem => item !== null)
    .filter((item) => !folderFilter || item.folderSlot === folderFilter);

  const openMonthKey = getOpenMonthKey(companyId);

  return {
    companyName: company.name,
    monthKey,
    readOnly: month.closedAt !== null,
    isOpenMonth: openMonthKey === monthKey,
    awaitingCount: countAwaitingDecision(documentRows),
    folderFilter: folderFilter ?? null,
    documents: documentItems,
  };
}

export function listDocumentFolderFilters(
  companyId: number,
  monthKey: string,
): string[] {
  const files = listFilesForMonth(companyId, monthKey);
  const slots = new Set<string>();
  for (const file of files) {
    if (isProcessedFolderSlot(file.folderSlot)) {
      slots.add(file.folderSlot);
    }
  }
  return [...slots].sort();
}
