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

/**
 * Presence-only (ADR 0013). The app records that a statement arrived and never
 * opens one. Pinned for the same reason as `PROCESSED_FOLDER_SLOTS`: renaming
 * it in settings must not silently stop the chase list from seeing statements.
 */
export const STATEMENT_FOLDER_SLOT = "03 Bankové výpisy";

export type ProcessedFolderSlot = (typeof PROCESSED_FOLDER_SLOTS)[number];

export type DocumentDecision = "confirmed" | "not_relevant";

export type DocumentForState = {
  decision: string | null;
  extractionStatus: string;
  extractionFailureReason: string | null;
  folderSlot: string;
  mimeType: string;
};

export type DerivedDocumentStatus =
  /** A parser is going to read this, or is reading it right now. */
  | { kind: "pending-extraction"; hint: string }
  /** A parser tried and could not read it. Her problem to solve. */
  | { kind: "manual-entry"; hint: string }
  /** No parser exists for this kind of document yet. Normal, not a problem. */
  | { kind: "manual-only"; hint: string }
  | { kind: "extracted"; hint: string }
  | { kind: "awaiting-decision"; hint: string };

/**
 * Whether a background parser will try to read this document. PDFs in invoice,
 * receipt and other processed folders go through eKasa and/or the local model;
 * photos and scans without OCR stay manual (ADR 0008 until slice 13).
 */
export function hasAutomaticExtraction(document: {
  folderSlot: string;
  mimeType: string;
}): boolean {
  if (document.mimeType !== "application/pdf") {
    return false;
  }
  if (
    document.folderSlot === CASH_FOLDER_SLOT ||
    document.folderSlot === CARD_FOLDER_SLOT
  ) {
    return true;
  }
  return (
    document.folderSlot.startsWith("01 ") ||
    document.folderSlot.startsWith("02 ") ||
    document.folderSlot.startsWith("06 ")
  );
}

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
    return hasAutomaticExtraction(document)
      ? { kind: "pending-extraction", hint: "Spracúva sa…" }
      : { kind: "manual-only", hint: "Vyplň ručne" };
  }
  if (document.extractionStatus === "failed") {
    return {
      kind: "manual-entry",
      hint: document.extractionFailureReason ?? "Treba vyplniť ručne",
    };
  }
  if (document.decision === null) {
    return { kind: "awaiting-decision", hint: "Čaká na rozhodnutie" };
  }
  return { kind: "extracted", hint: "Spracované" };
}

export function countAwaitingDecision(
  documents: Array<{ decision: string | null }>,
): number {
  return documents.filter((document) => document.decision === null).length;
}
