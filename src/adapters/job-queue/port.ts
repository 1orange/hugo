/** One file for the reading lane: a receipt (eKasa first) or a document. */
export type ExtractionJobData = {
  kind: "receipt" | "document";
  companyId: number;
  companyName: string;
  monthKey: string;
  driveFileId: string;
  fileName: string;
  folderSlot: string;
  mimeType: string;
  /** ISO time it was queued. */
  enqueuedAt: string;
  /** Set while it waits for OCR to come back. */
  waitingReason?: string | null;
  /**
   * An undecided result from an older pipeline, read again while it stays
   * complete: nothing is marked as being read, and a read that cannot be done
   * leaves the result as it was (PRD 0004).
   */
  reread?: boolean;
};

/**
 * A document the reading lane hands to the model lane: the text lines the model
 * reads, and what the model lane needs to finish the document. The model lane
 * neither downloads nor OCRs it again.
 */
export type ModelJobData = {
  kind: "receipt" | "document";
  companyId: number;
  companyName: string;
  monthKey: string;
  driveFileId: string;
  fileName: string;
  folderSlot: string;
  /** The text layer, or OCR of the pages. */
  source: "model" | "ocr";
  lines: string[];
  /** When the reading lane began the document: the duration recorded is the whole of it. */
  readStartedAt: number;
  /** ISO time the file was queued for reading. */
  enqueuedAt: string;
  /** Set while it waits for the model to come back. */
  waitingReason?: string | null;
  /**
   * The result a re-read keeps until the new one is written (PRD 0004), as the
   * reading lane found it. Absent when the document is not being re-read.
   */
  priorPayloadJson?: string | null;
};

/** Receipts go first: most are one eKasa lookup (ADR 0020). */
export const RECEIPT_PRIORITY = 1;
export const DOCUMENT_PRIORITY = 2;

export interface ExtractionJobQueue {
  /**
   * Queues the file for reading unless it is already waiting, being read, or
   * with the model — in any replica. True when this call queued it.
   */
  add(data: ExtractionJobData, options: { priority: number }): Promise<boolean>;

  /**
   * Hands a document to the model lane. False when the model lane already has
   * it: one job per file in each lane, so a file read twice is still read once.
   */
  handOff(data: ModelJobData): Promise<boolean>;
}

/** One document whose parties are to be checked against the registers (ADR 0022). */
export type SubjectVerificationJobData = {
  documentId: string;
  companyId: number;
  monthKey: string;
  driveFileId: string;
  /** ISO time it was queued. */
  enqueuedAt: string;
};

export interface SubjectVerificationQueue {
  /** Queues the document unless it is already waiting, in any replica. True when this call queued it. */
  add(data: SubjectVerificationJobData): Promise<boolean>;
}
