/**
 * ponytail: pinned to the default folder names while the canonical list itself is
 * editable in settings. Ceiling: rename one of these there and documents stop
 * being collected from it; upgrade path is a third editable list in settings.
 * Positional indexes into the canonical list are specifically not used —
 * reordering it would silently repoint which folders are processed and, via
 * `deriveReceiptKind`, which Omega ledger a document lands in.
 */
export const PROCESSED_FOLDER_SLOTS = [
  "01 Vystavené faktúry",
  "02 Prijaté faktúry",
  "04 Bločky_hotovosť",
  "05 Bločky_firemná karta",
  "06 Iné doklady",
] as const;

const CASH_FOLDER_SLOT = "04 Bločky_hotovosť";
const CARD_FOLDER_SLOT = "05 Bločky_firemná karta";

export type ProcessedFolderSlot = (typeof PROCESSED_FOLDER_SLOTS)[number];

export type DocumentDecision = "confirmed" | "not_relevant";

export type DocumentForState = {
  decision: string | null;
  extractionStatus: string;
  extractionFailureReason: string | null;
  folderSlot: string;
};

export type DerivedDocumentStatus =
  | { kind: "pending-extraction"; hint: string }
  | { kind: "manual-entry"; hint: string }
  | { kind: "extracted"; hint: string }
  | { kind: "awaiting-decision"; hint: string };

export function isProcessedFolderSlot(
  folderSlot: string | null,
): folderSlot is ProcessedFolderSlot {
  if (!folderSlot) {
    return false;
  }
  return (PROCESSED_FOLDER_SLOTS as readonly string[]).includes(folderSlot);
}

export function deriveReceiptKind(
  folderSlot: string,
): "cash" | "card" | null {
  if (folderSlot === CASH_FOLDER_SLOT) {
    return "cash";
  }
  if (folderSlot === CARD_FOLDER_SLOT) {
    return "card";
  }
  return null;
}

export function deriveDocumentStatus(
  document: DocumentForState,
): DerivedDocumentStatus {
  if (document.extractionStatus === "pending") {
    return { kind: "pending-extraction", hint: "Extraction pending" };
  }
  if (document.extractionStatus === "failed") {
    return {
      kind: "manual-entry",
      hint: document.extractionFailureReason ?? "Manual entry needed",
    };
  }
  if (document.decision === null) {
    return { kind: "awaiting-decision", hint: "Awaiting your decision" };
  }
  return { kind: "extracted", hint: "Extracted" };
}

export function countAwaitingDecision(
  documents: Array<{ decision: string | null }>,
): number {
  return documents.filter((document) => document.decision === null).length;
}
