import { and, eq, isNull, sql } from "drizzle-orm";
import { documents, files } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import {
  emptyExtractedPayload,
  serializeExtractedPayload,
  serializeConfirmedPayload,
  type ConfirmedPayload,
  type EkasaExtractedPayload,
  type ExtractedPayload,
} from "@/modules/document-payload";
import { isProcessedFolderSlot } from "@/modules/document-state";
import {
  EXTRACTION_PIPELINE_VERSION,
  needsExtraction,
} from "@/modules/extraction-pipeline";

export type DocumentRow = {
  /** The document's own key: its file's ID, or `<file>#<UID>` for extra receipts. */
  id: string;
  driveFileId: string;
  receiptUid: string | null;
  companyId: number;
  monthKey: string;
  folderSlot: string;
  decision: string | null;
  notRelevantReason: string | null;
  decidedAt: string | null;
  extractionStatus: string;
  extractionFailureReason: string | null;
  extractionPipelineVersion: number | null;
  extractedPayloadJson: string;
  confirmedPayloadJson: string;
  note: string | null;
  exportedAt: string | null;
  exportBatch: string | null;
  exportNumber: string | null;
  createdAt: string;
};

export type ExtractionStatus = "pending" | "complete" | "failed";

export function getDocument(documentId: string): DocumentRow | undefined {
  const db = getDb();
  return db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .get();
}

/** Every document read out of one file: its own, then any further receipts. */
export function listDocumentsForFile(driveFileId: string): DocumentRow[] {
  const db = getDb();
  return db
    .select()
    .from(documents)
    .where(eq(documents.driveFileId, driveFileId))
    .all()
    .sort((left, right) => {
      if (left.id === driveFileId) return -1;
      if (right.id === driveFileId) return 1;
      return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
    });
}

export function listDocumentsForMonth(
  companyId: number,
  monthKey: string,
): DocumentRow[] {
  const db = getDb();
  return db
    .select()
    .from(documents)
    .where(
      and(eq(documents.companyId, companyId), eq(documents.monthKey, monthKey)),
    )
    .all();
}

export function listDocumentsForCompany(companyId: number): DocumentRow[] {
  const db = getDb();
  return db.select().from(documents).where(eq(documents.companyId, companyId)).all();
}

export function countAwaitingDecision(
  companyId: number,
  monthKey: string,
): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.monthKey, monthKey),
        isNull(documents.decision),
      ),
    )
    .get();
  return row?.count ?? 0;
}

export function companyHasDocuments(companyId: number): boolean {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(eq(documents.companyId, companyId))
    .get();
  return (row?.count ?? 0) > 0;
}

export function ensureDocumentsForMonth(
  companyId: number,
  monthKey: string,
  createdAt: string,
): number {
  const db = getDb();
  const eligible = db
    .select({
      driveFileId: files.driveFileId,
      folderSlot: files.folderSlot,
    })
    .from(files)
    .where(
      and(
        eq(files.companyId, companyId),
        eq(files.monthKey, monthKey),
        eq(files.deleted, false),
      ),
    )
    .all()
    .filter((file) => isProcessedFolderSlot(file.folderSlot));

  let created = 0;
  for (const file of eligible) {
    const folderSlot = file.folderSlot!;
    const existing = getDocument(file.driveFileId);
    if (existing) {
      if (existing.folderSlot !== folderSlot) {
        // Every receipt read out of the file moves with it.
        db.update(documents)
          .set({ folderSlot })
          .where(eq(documents.driveFileId, file.driveFileId))
          .run();
      }
      continue;
    }

    const result = db
      .insert(documents)
      .values({
        id: file.driveFileId,
        driveFileId: file.driveFileId,
        companyId,
        monthKey,
        folderSlot,
        extractionStatus: "pending",
        extractedPayloadJson: serializeExtractedPayload(emptyExtractedPayload()),
        confirmedPayloadJson: "{}",
        createdAt,
      })
      .onConflictDoNothing()
      .run();
    if (result.changes > 0) {
      created += 1;
    }
  }
  return created;
}

export function setDocumentDecision(
  documentId: string,
  decision: "confirmed" | "not_relevant" | null,
  input: {
    decidedAt: string | null;
    notRelevantReason?: string | null;
  },
): DocumentRow | undefined {
  const db = getDb();
  db.update(documents)
    .set({
      decision,
      decidedAt: input.decidedAt,
      notRelevantReason:
        decision === "not_relevant" ? (input.notRelevantReason ?? null) : null,
    })
    .where(eq(documents.id, documentId))
    .run();
  return getDocument(documentId);
}

export function updateDocumentNote(
  documentId: string,
  note: string | null,
): void {
  const db = getDb();
  db.update(documents)
    .set({ note })
    .where(eq(documents.id, documentId))
    .run();
}

export function setExtractionStatus(
  documentId: string,
  status: ExtractionStatus,
  failureReason: string | null,
): void {
  const db = getDb();
  db.update(documents)
    .set({
      extractionStatus: status,
      extractionFailureReason: failureReason,
    })
    .where(eq(documents.id, documentId))
    .run();
}

export function writeExtractedPayload(
  documentId: string,
  payload: ExtractedPayload,
  status: ExtractionStatus,
  failureReason: string | null,
): DocumentRow | undefined {
  const db = getDb();
  db.update(documents)
    .set({
      extractedPayloadJson: serializeExtractedPayload(payload),
      extractionStatus: status,
      extractionFailureReason: failureReason,
    })
    .where(eq(documents.id, documentId))
    .run();
  return getDocument(documentId);
}

export function writeConfirmedPayload(
  documentId: string,
  payload: ConfirmedPayload,
): DocumentRow | undefined {
  const db = getDb();
  db.update(documents)
    .set({ confirmedPayloadJson: serializeConfirmedPayload(payload) })
    .where(eq(documents.id, documentId))
    .run();
  return getDocument(documentId);
}

export function upsertEkasaExtractedPayload(input: {
  /** Defaults to the file's own document. */
  documentId?: string;
  driveFileId: string;
  /** Set for an extra receipt of a multi-receipt file. */
  receiptUid?: string | null;
  companyId: number;
  monthKey: string;
  folderSlot: string;
  payload: EkasaExtractedPayload | ExtractedPayload;
  extractionStatus: ExtractionStatus;
  extractionFailureReason: string | null;
  createdAt: string;
}): DocumentRow {
  const db = getDb();
  const serialized = serializeExtractedPayload(input.payload);
  const documentId = input.documentId ?? input.driveFileId;
  db.insert(documents)
    .values({
      id: documentId,
      driveFileId: input.driveFileId,
      receiptUid: input.receiptUid ?? null,
      companyId: input.companyId,
      monthKey: input.monthKey,
      folderSlot: input.folderSlot,
      extractionStatus: input.extractionStatus,
      extractionFailureReason: input.extractionFailureReason,
      extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION,
      extractedPayloadJson: serialized,
      confirmedPayloadJson: "{}",
      createdAt: input.createdAt,
    })
    .onConflictDoUpdate({
      target: documents.id,
      set: {
        folderSlot: input.folderSlot,
        extractedPayloadJson: serialized,
        extractionStatus: input.extractionStatus,
        extractionFailureReason: input.extractionFailureReason,
        extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION,
      },
    })
    .run();
  return getDocument(documentId)!;
}

export function listPendingExtractionForMonth(
  companyId: number,
  monthKey: string,
): Array<{ documentId: string; driveFileId: string; extractionFailureReason: string | null }> {
  const db = getDb();
  return db
    .select({
      documentId: documents.id,
      driveFileId: documents.driveFileId,
      extractionFailureReason: documents.extractionFailureReason,
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.monthKey, monthKey),
        eq(documents.extractionStatus, "pending"),
      ),
    )
    .all();
}

export function extractionAlreadyAttempted(documentId: string): boolean {
  return !needsExtraction(getDocument(documentId));
}

/**
 * One unreadable file must not abandon the rest of the month: the error is
 * recorded on its document, where she sees it, and discovery moves on.
 */
export function recordExtractionCrash(documentId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  writeExtractedPayload(documentId, {}, "failed", `Reading the document failed: ${message}`);
}

/** Marks a document as being read now, by the current pipeline. */
export function beginExtractionAttempt(documentId: string): void {
  const db = getDb();
  db.update(documents)
    .set({
      extractionStatus: "pending",
      extractionFailureReason: null,
      extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION,
    })
    .where(eq(documents.id, documentId))
    .run();
}

export function listExportNumbersForCompany(companyId: number): string[] {
  const db = getDb();
  const rows = db
    .select({ exportNumber: documents.exportNumber })
    .from(documents)
    .where(eq(documents.companyId, companyId))
    .all();
  return rows
    .map((row) => row.exportNumber)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function setDocumentExportNumber(
  documentId: string,
  exportNumber: string,
): void {
  const db = getDb();
  db.update(documents)
    .set({ exportNumber })
    .where(eq(documents.id, documentId))
    .run();
}

export function markDocumentsExported(input: {
  documentIds: readonly string[];
  exportedAt: string;
  exportBatch: string;
}): void {
  const db = getDb();
  for (const documentId of input.documentIds) {
    db.update(documents)
      .set({
        exportedAt: input.exportedAt,
        exportBatch: input.exportBatch,
      })
      .where(eq(documents.id, documentId))
      .run();
  }
}
