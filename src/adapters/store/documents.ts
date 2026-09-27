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

export type DocumentRow = {
  driveFileId: string;
  companyId: number;
  monthKey: string;
  folderSlot: string;
  decision: string | null;
  notRelevantReason: string | null;
  decidedAt: string | null;
  extractionStatus: string;
  extractionFailureReason: string | null;
  extractedPayloadJson: string;
  confirmedPayloadJson: string;
  note: string | null;
  exportedAt: string | null;
  exportBatch: string | null;
  exportNumber: string | null;
  createdAt: string;
};

export type ExtractionStatus = "pending" | "complete" | "failed";

export function getDocument(driveFileId: string): DocumentRow | undefined {
  const db = getDb();
  return db
    .select()
    .from(documents)
    .where(eq(documents.driveFileId, driveFileId))
    .get();
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
  driveFileId: string,
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
    .where(eq(documents.driveFileId, driveFileId))
    .run();
  return getDocument(driveFileId);
}

export function updateDocumentNote(
  driveFileId: string,
  note: string | null,
): void {
  const db = getDb();
  db.update(documents)
    .set({ note })
    .where(eq(documents.driveFileId, driveFileId))
    .run();
}

export function setExtractionStatus(
  driveFileId: string,
  status: ExtractionStatus,
  failureReason: string | null,
): void {
  const db = getDb();
  db.update(documents)
    .set({
      extractionStatus: status,
      extractionFailureReason: failureReason,
    })
    .where(eq(documents.driveFileId, driveFileId))
    .run();
}

export function writeExtractedPayload(
  driveFileId: string,
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
    .where(eq(documents.driveFileId, driveFileId))
    .run();
  return getDocument(driveFileId);
}

export function writeConfirmedPayload(
  driveFileId: string,
  payload: ConfirmedPayload,
): DocumentRow | undefined {
  const db = getDb();
  db.update(documents)
    .set({ confirmedPayloadJson: serializeConfirmedPayload(payload) })
    .where(eq(documents.driveFileId, driveFileId))
    .run();
  return getDocument(driveFileId);
}

export function upsertEkasaExtractedPayload(input: {
  driveFileId: string;
  companyId: number;
  monthKey: string;
  folderSlot: string;
  payload: EkasaExtractedPayload;
  extractionStatus: ExtractionStatus;
  extractionFailureReason: string | null;
  createdAt: string;
}): DocumentRow {
  const db = getDb();
  const serialized = serializeExtractedPayload(input.payload);
  db.insert(documents)
    .values({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      folderSlot: input.folderSlot,
      extractionStatus: input.extractionStatus,
      extractionFailureReason: input.extractionFailureReason,
      extractedPayloadJson: serialized,
      confirmedPayloadJson: "{}",
      createdAt: input.createdAt,
    })
    .onConflictDoUpdate({
      target: documents.driveFileId,
      set: {
        folderSlot: input.folderSlot,
        extractedPayloadJson: serialized,
        extractionStatus: input.extractionStatus,
        extractionFailureReason: input.extractionFailureReason,
      },
    })
    .run();
  return getDocument(input.driveFileId)!;
}

export function listPendingExtractionForMonth(
  companyId: number,
  monthKey: string,
): Array<{ driveFileId: string; extractionFailureReason: string | null }> {
  const db = getDb();
  return db
    .select({
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

export function extractionAlreadyAttempted(driveFileId: string): boolean {
  const document = getDocument(driveFileId);
  return document !== undefined && document.extractionStatus !== "pending";
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
  driveFileId: string,
  exportNumber: string,
): void {
  const db = getDb();
  db.update(documents)
    .set({ exportNumber })
    .where(eq(documents.driveFileId, driveFileId))
    .run();
}

export function markDocumentsExported(input: {
  driveFileIds: readonly string[];
  exportedAt: string;
  exportBatch: string;
}): void {
  const db = getDb();
  for (const driveFileId of input.driveFileIds) {
    db.update(documents)
      .set({
        exportedAt: input.exportedAt,
        exportBatch: input.exportBatch,
      })
      .where(eq(documents.driveFileId, driveFileId))
      .run();
  }
}
