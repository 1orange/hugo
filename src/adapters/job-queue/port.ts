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
