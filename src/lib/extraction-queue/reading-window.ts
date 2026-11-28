import { BullmqExtractionJobQueue } from "@/adapters/job-queue/bullmq-queues";
import { priorityFor, type ExtractionJobQueue } from "@/adapters/job-queue/port";
import { listCompanies } from "@/adapters/store/companies";
import {
  beginExtractionAttempt,
  listProcessedFilesWithDocuments,
  placeDocumentsForFiles,
  type ProcessedFileWithDocument,
} from "@/adapters/store/documents";
import { listAllMonths } from "@/adapters/store/months";
import { getSettings } from "@/adapters/store/settings";
import { announce } from "@/lib/events/bus";
import { RECEIPT_FOLDER_SLOTS } from "@/lib/cash-discovery/discover-cash-payments";
import { isReceiptImageMimeType } from "@/lib/cash-discovery/ekasa-qr-extraction";
import { MODEL_EXTRACTION_FOLDER_PREFIXES } from "@/lib/model-extraction/discover-model-extraction";
import { isProcessedFolderSlot, isStatementFolderSlot } from "@/modules/document-state";
import { needsExtraction, needsPipelineReread } from "@/modules/extraction-pipeline";
import {
  planReading,
  readingWindowStartFor,
  type ReadingTier,
} from "@/modules/reading-planner";

export type ReadingKind = "receipt" | "document";

/**
 * The kind a file is read as, by the rules the per-month lists use: a PDF in a
 * receipt folder and any receipt photo in a processed folder are receipts (the
 * eKasa path); a PDF in an invoice or other-document folder is a document (the
 * model). Null for everything else, which no sweep reads.
 */
export function readingKindOf(file: { folderSlot: string | null; mimeType: string }): ReadingKind | null {
  const slot = file.folderSlot ?? "";
  if (file.mimeType === "application/pdf") {
    if ((RECEIPT_FOLDER_SLOTS as readonly string[]).includes(slot)) {
      return "receipt";
    }
    if (isProcessedFolderSlot(slot) && MODEL_EXTRACTION_FOLDER_PREFIXES.some((prefix) => slot.startsWith(prefix))) {
      return "document";
    }
    return null;
  }
  return isProcessedFolderSlot(slot) && isReceiptImageMimeType(file.mimeType) ? "receipt" : null;
}

function monthId(companyId: number, monthKey: string): string {
  return `${companyId}/${monthKey}`;
}

/**
 * Queues every unread document of every month the reading plan names (ADR
 * 0020, amended 2026-11-23): the raised month, the recent tier, then the
 * backlog newest first. It finds the files in one store query and queues them
 * as the per-month path does: one job per file, its id the file's, so a file
 * found by a notification, the poll and a page is read once.
 *
 * Returns how many this call queued. Takes the queue as a port, so tests run it
 * against the in-memory one.
 */
export async function queueReadingWindow(
  queue: ExtractionJobQueue,
  options: {
    windowStart: string;
    raised?: { companyId: number; monthKey: string } | null;
    instant?: Date;
  },
): Promise<number> {
  const instant = options.instant ?? new Date();
  const [activeCompanies, months] = await Promise.all([listCompanies(), listAllMonths()]);
  const companyNames = new Map(activeCompanies.map((company) => [company.id, company.name]));

  const plan = planReading({
    months: months
      .filter((month) => companyNames.has(month.companyId))
      .map((month) => ({ companyId: month.companyId, monthKey: month.monthKey, closed: month.closedAt !== null })),
    instant,
    windowStart: options.windowStart,
    raised: options.raised ?? null,
  });
  if (plan.length === 0) {
    return 0;
  }

  const planIndex = new Map(plan.map((entry, index) => [monthId(entry.companyId, entry.monthKey), index]));
  const monthKeys = [...new Set(plan.map((entry) => entry.monthKey))];
  const files = await listProcessedFilesWithDocuments(monthKeys);

  type Candidate = {
    file: ProcessedFileWithDocument;
    folderSlot: string;
    kind: ReadingKind;
    tier: ReadingTier;
    index: number;
  };
  const candidates: Candidate[] = [];
  const toPlace: Array<{ driveFileId: string; companyId: number; monthKey: string; folderSlot: string }> = [];
  for (const file of files) {
    const index = planIndex.get(monthId(file.companyId, file.monthKey));
    if (index === undefined || file.folderSlot === null) {
      continue;
    }
    const folderSlot = file.folderSlot;
    const document = file.document;
    // A file with no document yet, or one filed under another month or folder
    // (it moved), gets its document placed before it is queued.
    if (
      document === null ||
      document.companyId !== file.companyId ||
      document.monthKey !== file.monthKey ||
      document.folderSlot !== folderSlot
    ) {
      toPlace.push({ driveFileId: file.driveFileId, companyId: file.companyId, monthKey: file.monthKey, folderSlot });
    }
    // A statement is placed, never read (0007/12).
    const kind = isStatementFolderSlot(folderSlot) ? null : readingKindOf(file);
    if (kind === null) {
      continue;
    }
    candidates.push({ file, folderSlot, kind, tier: plan[index]!.tier, index });
  }
  const now = instant.toISOString();
  await placeDocumentsForFiles(toPlace, now);

  // Plan order first (raised, recent, then newest backlog month); within a month,
  // the file's ID, so the same sweep always queues the same way.
  candidates.sort((left, right) => left.index - right.index || left.file.driveFileId.localeCompare(right.file.driveFileId));

  let added = 0;
  for (const { file, folderSlot, kind, tier } of candidates) {
    const document = file.document ?? undefined;
    const reread = !needsExtraction(document) && kind === "document" && needsPipelineReread(document);
    if (!needsExtraction(document) && !reread) {
      continue;
    }
    const queued = await queue.add(
      {
        kind,
        companyId: file.companyId,
        companyName: companyNames.get(file.companyId) ?? `#${file.companyId}`,
        monthKey: file.monthKey,
        driveFileId: file.driveFileId,
        fileName: file.name,
        folderSlot,
        mimeType: file.mimeType,
        enqueuedAt: now,
        tier,
        ...(reread ? { reread: true } : {}),
      },
      { priority: priorityFor(kind, tier) },
    );
    if (queued) {
      if (!reread) {
        await beginExtractionAttempt(file.driveFileId);
      }
      added += 1;
    }
  }
  if (added > 0) {
    announce({ type: "queue-changed" });
  }
  return added;
}

/**
 * What a sweep or a page asks for after it has answered: the reading window,
 * queued on the Redis queue with the stored window start. Never throws: a Redis
 * that does not answer must not fail the page or the poll, and the next sweep
 * queues the same files again.
 */
export async function queueReadingWindowForExtraction(
  raised: { companyId: number; monthKey: string } | null = null,
): Promise<void> {
  try {
    const settings = await getSettings();
    const windowStart = readingWindowStartFor(settings.readingWindowStart, new Date());
    await queueReadingWindow(new BullmqExtractionJobQueue(), { windowStart, raised });
  } catch (error) {
    console.warn("[queue] could not queue the reading window", error);
  }
}
