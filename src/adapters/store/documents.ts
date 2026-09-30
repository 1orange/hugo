import { and, count, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { documents, files } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import {
  emptyExtractedPayload,
  serializeExtractedPayload,
  serializeConfirmedPayload,
  type ConfirmedPayload,
  type EkasaExtractedPayload,
  type ExtractedPayload,
} from "@/modules/document-payload";
import { isProcessedFolderSlot } from "@/modules/document-state";
import { isSystemFile } from "@/modules/system-files";
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

export async function getDocument(documentId: string): Promise<DocumentRow | undefined> {
  const db = getDb();
  const [row] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  return row;
}

/** Every document read out of one file: its own, then any further receipts. */
export async function listDocumentsForFile(driveFileId: string): Promise<DocumentRow[]> {
  const db = getDb();
  const rows = await db.select().from(documents).where(eq(documents.driveFileId, driveFileId));
  return rows.sort((left, right) => {
    if (left.id === driveFileId) return -1;
    if (right.id === driveFileId) return 1;
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  });
}

export async function listDocumentsForMonth(
  companyId: number,
  monthKey: string,
): Promise<DocumentRow[]> {
  const db = getDb();
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.monthKey, monthKey)));
}

export async function listDocumentsForCompany(companyId: number): Promise<DocumentRow[]> {
  const db = getDb();
  return db.select().from(documents).where(eq(documents.companyId, companyId));
}

export async function countAwaitingDecision(
  companyId: number,
  monthKey: string,
): Promise<number> {
  const db = getDb();
  // A document whose file is gone from Drive is not in the workbench, so it
  // cannot be decided; counting it left the chase list waiting for ever.
  const [row] = await db
    .select({ count: count() })
    .from(documents)
    .innerJoin(files, eq(files.driveFileId, documents.driveFileId))
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.monthKey, monthKey),
        isNull(documents.decision),
        eq(files.deleted, false),
      ),
    );
  return row?.count ?? 0;
}

export async function companyHasDocuments(companyId: number): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ count: count() })
    .from(documents)
    .where(eq(documents.companyId, companyId));
  return (row?.count ?? 0) > 0;
}

export async function ensureDocumentsForMonth(
  companyId: number,
  monthKey: string,
  createdAt: string,
): Promise<number> {
  const db = getDb();
  const eligible = (
    await db
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
  ).filter((file) => isProcessedFolderSlot(file.folderSlot));
  if (eligible.length === 0) {
    return 0;
  }

  const existingSlots = new Map(
    (
      await db
        .select({ id: documents.id, folderSlot: documents.folderSlot })
        .from(documents)
        .where(inArray(documents.id, eligible.map((file) => file.driveFileId)))
    ).map((row) => [row.id, row.folderSlot]),
  );

  let created = 0;
  for (const file of eligible) {
    const folderSlot = file.folderSlot!;
    const existingSlot = existingSlots.get(file.driveFileId);
    if (existingSlot !== undefined) {
      if (existingSlot !== folderSlot) {
        // Every receipt read out of the file moves with it.
        await db
          .update(documents)
          .set({ folderSlot })
          .where(eq(documents.driveFileId, file.driveFileId));
      }
      continue;
    }

    const inserted = await db
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
      .returning({ id: documents.id });
    created += inserted.length;
  }
  return created;
}

export async function setDocumentDecision(
  documentId: string,
  decision: "confirmed" | "not_relevant" | null,
  input: {
    decidedAt: string | null;
    notRelevantReason?: string | null;
  },
): Promise<DocumentRow | undefined> {
  const db = getDb();
  const [row] = await db
    .update(documents)
    .set({
      decision,
      decidedAt: input.decidedAt,
      notRelevantReason:
        decision === "not_relevant" ? (input.notRelevantReason ?? null) : null,
    })
    .where(eq(documents.id, documentId))
    .returning();
  return row;
}

export async function updateDocumentNote(
  documentId: string,
  note: string | null,
): Promise<void> {
  const db = getDb();
  await db.update(documents).set({ note }).where(eq(documents.id, documentId));
}

export async function setExtractionStatus(
  documentId: string,
  status: ExtractionStatus,
  failureReason: string | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(documents)
    .set({
      extractionStatus: status,
      extractionFailureReason: failureReason,
    })
    .where(eq(documents.id, documentId));
}

export async function writeExtractedPayload(
  documentId: string,
  payload: ExtractedPayload,
  status: ExtractionStatus,
  failureReason: string | null,
): Promise<DocumentRow | undefined> {
  const db = getDb();
  const [row] = await db
    .update(documents)
    .set({
      extractedPayloadJson: serializeExtractedPayload(payload),
      extractionStatus: status,
      extractionFailureReason: failureReason,
    })
    .where(eq(documents.id, documentId))
    .returning();
  return row;
}

export async function writeConfirmedPayload(
  documentId: string,
  payload: ConfirmedPayload,
): Promise<DocumentRow | undefined> {
  const db = getDb();
  const [row] = await db
    .update(documents)
    .set({ confirmedPayloadJson: serializeConfirmedPayload(payload) })
    .where(eq(documents.id, documentId))
    .returning();
  return row;
}

export async function upsertEkasaExtractedPayload(input: {
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
}): Promise<DocumentRow> {
  const db = getDb();
  const serialized = serializeExtractedPayload(input.payload);
  const documentId = input.documentId ?? input.driveFileId;
  const [row] = await db
    .insert(documents)
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
    .returning();
  return row!;
}

export async function listPendingExtractionForMonth(
  companyId: number,
  monthKey: string,
): Promise<Array<{ documentId: string; driveFileId: string; extractionFailureReason: string | null }>> {
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
    );
}

export async function extractionAlreadyAttempted(documentId: string): Promise<boolean> {
  return !needsExtraction(await getDocument(documentId));
}

/**
 * One unreadable file must not abandon the rest of the month: the error is
 * recorded on its document, where she sees it, and discovery moves on.
 */
export async function recordExtractionCrash(documentId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await writeExtractedPayload(documentId, {}, "failed", `Reading the document failed: ${message}`);
}

/** Marks a document as being read now, by the current pipeline. */
export async function beginExtractionAttempt(documentId: string): Promise<void> {
  const db = getDb();
  await db
    .update(documents)
    .set({
      extractionStatus: "pending",
      extractionFailureReason: null,
      extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION,
    })
    .where(eq(documents.id, documentId));
}

/**
 * Her request to read a file again, by the pipeline as it is now: its
 * document goes back to pending, as if never attempted. What was extracted
 * stays until the new read replaces it — a UID she typed, the eKasa
 * response already fetched — and her own values are never touched.
 */
export async function markForReextraction(driveFileId: string): Promise<void> {
  const db = getDb();
  await db
    .update(documents)
    .set({ extractionStatus: "pending", extractionFailureReason: null, extractionPipelineVersion: null })
    .where(eq(documents.id, driveFileId));
}

export async function listExportNumbersForCompany(companyId: number): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ exportNumber: documents.exportNumber })
    .from(documents)
    .where(eq(documents.companyId, companyId));
  return rows
    .map((row) => row.exportNumber)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export async function setDocumentExportNumber(
  documentId: string,
  exportNumber: string,
): Promise<void> {
  const db = getDb();
  await db.update(documents).set({ exportNumber }).where(eq(documents.id, documentId));
}

export async function markDocumentsExported(input: {
  documentIds: readonly string[];
  exportedAt: string;
  exportBatch: string;
}): Promise<void> {
  if (input.documentIds.length === 0) {
    return;
  }
  const db = getDb();
  await db
    .update(documents)
    .set({
      exportedAt: input.exportedAt,
      exportBatch: input.exportBatch,
    })
    .where(inArray(documents.id, [...input.documentIds]));
}

/**
 * desktop.ini and its kind never enter the app (system-files module), but
 * sweeps before that rule recorded ten of them as documents, pending for
 * ever: nothing reads or shows a document whose file is gone. They are
 * forgotten with their file records — unless she decided or exported one,
 * which is kept as she left it. Returns how many files were forgotten.
 */
export async function forgetSystemFiles(): Promise<number> {
  const db = getDb();
  const systemFileIds = (
    await db.select({ driveFileId: files.driveFileId, name: files.name }).from(files).where(eq(files.deleted, true))
  )
    .filter((file) => isSystemFile(file.name))
    .map((file) => file.driveFileId);
  if (systemFileIds.length === 0) {
    return 0;
  }
  const handled = new Set(
    (
      await db
        .select({ driveFileId: documents.driveFileId })
        .from(documents)
        .where(
          and(
            inArray(documents.driveFileId, systemFileIds),
            or(isNotNull(documents.decision), isNotNull(documents.exportedAt)),
          ),
        )
    ).map((row) => row.driveFileId),
  );
  const forgotten = systemFileIds.filter((id) => !handled.has(id));
  if (forgotten.length === 0) {
    return 0;
  }
  await db.delete(documents).where(inArray(documents.driveFileId, forgotten));
  await db.delete(files).where(inArray(files.driveFileId, forgotten));
  return forgotten.length;
}
