import { extractionFailureMessage } from "./extraction-failure";
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
  "04 Bločky",
  "06 Ostatné dokumenty",
] as const;

/** Cash and card receipts are one type since the office's eight types (2026-11-12). */
const RECEIPT_FOLDER_SLOT = "04 Bločky";

/**
 * A statement is never read (ADR 0013, amended 2026-11-23): Hugo lists it and
 * takes her decision on it, and no reader, model or export ever sees its
 * contents. Pinned for the same reason as `PROCESSED_FOLDER_SLOTS`: renaming
 * it in settings must not silently stop the chase list from seeing statements.
 */
export const STATEMENT_FOLDER_SLOT = "03 Bankové výpisy" as const;

/**
 * The extraction status of a statement's document. Terminal: nothing reads a
 * statement, so it never moves on. It lives in the status column rather than
 * being decided from the folder at each query, so every "is this read yet"
 * question answers no for a statement with no folder check of its own.
 */
export const NOT_READ_EXTRACTION_STATUS = "not-read";

export type ProcessedFolderSlot = (typeof PROCESSED_FOLDER_SLOTS)[number];

/** Every folder whose files get document rows: the processed ones, and statements. */
export type DocumentFolderSlot = ProcessedFolderSlot | typeof STATEMENT_FOLDER_SLOT;

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
  /** A statement: listed and decided, never read (ADR 0013, amended 2026-11-23). */
  | { kind: "not-read"; hint: string }
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
  if (document.folderSlot === RECEIPT_FOLDER_SLOT) {
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

export function isStatementFolderSlot(
  folderSlot: string | null,
): folderSlot is typeof STATEMENT_FOLDER_SLOT {
  return folderSlot === STATEMENT_FOLDER_SLOT;
}

/** A folder whose files get document rows: the processed folders, and statements, which are listed but never read. */
export function isDocumentFolderSlot(
  folderSlot: string | null,
): folderSlot is DocumentFolderSlot {
  return isProcessedFolderSlot(folderSlot) || isStatementFolderSlot(folderSlot);
}

/**
 * "receipt" for the receipts folder: eKasa reading, the UID box. Cash and card are no
 * longer told apart by folder; nothing downstream needed the difference.
 */
export function deriveReceiptKind(folderSlot: string): "receipt" | null {
  return folderSlot === RECEIPT_FOLDER_SLOT ? "receipt" : null;
}

export function deriveDocumentStatus(
  document: DocumentForState,
): DerivedDocumentStatus {
  if (document.extractionStatus === NOT_READ_EXTRACTION_STATUS) {
    return { kind: "not-read", hint: "Nečíta sa" };
  }
  if (document.extractionStatus === "pending") {
    return hasAutomaticExtraction(document)
      ? { kind: "pending-extraction", hint: "Spracúva sa…" }
      : { kind: "manual-only", hint: "Vyplň ručne" };
  }
  if (document.extractionStatus === "failed") {
    return {
      kind: "manual-entry",
      hint: document.extractionFailureReason ? extractionFailureMessage(document.extractionFailureReason) : "Treba vyplniť ručne",
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
