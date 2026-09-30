import { appendUserEvent } from "@/adapters/store/events";
import { getDocument, listDocumentsForFile, markForReextraction } from "@/adapters/store/documents";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import type { DocumentActionResult } from "./service";

/**
 * Reads a document's file again, with the pipeline as it is now: after a fix
 * reached the app, or when a read went wrong. The extraction pipeline reads a
 * document once — a complete one is never read again, a failed one only when
 * the pipeline's version moves — so this is how she asks.
 *
 * Only while nothing of the file is decided or exported: a new read could
 * change a value she has accepted, under her. A file with several receipts
 * is read whole, so every one of them must be open.
 */
export async function requestDocumentReextraction(input: {
  companyId: number;
  monthKey: string;
  documentId: string;
  /** Queues the month's pending documents (scheduleDocumentExtractionForMonth). */
  schedule: (companyId: number, monthKey: string) => Promise<void>;
  now?: string;
}): Promise<DocumentActionResult> {
  const readOnly = await assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }
  const document = await getDocument(input.documentId);
  if (!document || document.companyId !== input.companyId || document.monthKey !== input.monthKey) {
    return { ok: false, message: "Doklad sa v tomto mesiaci nenašiel." };
  }
  const ofFile = await listDocumentsForFile(document.driveFileId);
  if (ofFile.some((entry) => entry.exportedAt !== null)) {
    return { ok: false, message: "Doklad už bol exportovaný do Omegy — znova sa načítať nedá." };
  }
  if (ofFile.some((entry) => entry.decision !== null)) {
    return { ok: false, message: "Doklad je už rozhodnutý — najprv rozhodnutie vráť." };
  }

  const now = input.now ?? new Date().toISOString();
  await markForReextraction(document.driveFileId);
  await appendUserEvent(now, input.companyId, "ReextractionRequested", {
    monthKey: input.monthKey,
    driveFileId: document.driveFileId,
    documentId: document.id,
  });
  await input.schedule(input.companyId, input.monthKey);
  return { ok: true };
}
