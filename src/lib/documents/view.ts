import { getCompanyById } from "@/adapters/store/companies";
import { listFilesForMonth } from "@/adapters/store/files";
import {
  ensureDocumentsForMonth,
  listDocumentsForMonth,
} from "@/adapters/store/documents";
import { getMonthByKey, getOpenMonthKey } from "@/adapters/store/months";
import { formatEuroFromCents } from "@/modules/money";
import {
  countAwaitingDecision,
  deriveDocumentStatus,
  deriveReceiptKind,
  isProcessedFolderSlot,
  type DerivedDocumentStatus,
  type ProcessedFolderSlot,
} from "@/modules/document-state";
import {
  isEkasaPayload,
  parseExtractedPayload,
} from "@/modules/document-payload";

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

function formatAmount(
  amountLiteral: string | null,
  amountCents: number | null,
  currency: string,
): string {
  if (amountLiteral) {
    return `${amountLiteral} ${currency}`;
  }
  if (amountCents !== null) {
    return `${formatEuroFromCents(amountCents)} ${currency}`;
  }
  return "—";
}

function documentLabel(
  name: string,
  payload: ReturnType<typeof parseExtractedPayload>,
): string {
  if (isEkasaPayload(payload) && payload.supplierName) {
    return payload.supplierName;
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
      const amountDisplay = isEkasaPayload(payload)
        ? formatAmount(payload.amountLiteral, payload.amountCents, payload.currency)
        : "—";
      const receiptDisplay = isEkasaPayload(payload)
        ? formatReceiptAt(payload.receiptAt)
        : "—";

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
        label: documentLabel(file.name, payload),
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
