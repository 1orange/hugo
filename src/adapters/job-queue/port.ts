/** One file to read: a receipt (eKasa first) or a document (the model). */
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
  /** Set while it waits for the model or OCR to come back. */
  waitingReason?: string | null;
  /**
   * An undecided result from an older pipeline, read again while it stays
   * complete: nothing is marked as being read, and a read that cannot be done
   * leaves the result as it was (PRD 0004).
   */
  reread?: boolean;
};

/** Receipts go first: most are one eKasa lookup (ADR 0020). */
export const RECEIPT_PRIORITY = 1;
export const DOCUMENT_PRIORITY = 2;

export interface ExtractionJobQueue {
  /**
   * Queues the file unless it is already waiting, being read, or waiting for
   * a service — in any replica. True when this call queued it.
   */
  add(data: ExtractionJobData, options: { priority: number }): Promise<boolean>;
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
