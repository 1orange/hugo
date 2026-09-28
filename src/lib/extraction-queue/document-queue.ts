import {
  beginExtractionAttempt,
  ensureDocumentsForMonth,
  getDocument,
  recordExtractionCrash,
} from "@/adapters/store/documents";
import {
  listCashReceiptCandidates,
  processCashReceiptFile,
  type CashDiscoveryDeps,
} from "@/lib/cash-discovery/discover-cash-payments";
import { listModelExtractionCandidates } from "@/lib/model-extraction/discover-model-extraction";
import { processModelExtractionFile } from "@/lib/model-extraction/process-model-extraction";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import { needsExtraction } from "@/modules/extraction-pipeline";
import { KeyedQueue } from "./keyed-queue";

type ExtractionJob = {
  kind: "receipt" | "document";
  companyId: number;
  monthKey: string;
  driveFileId: string;
  folderSlot: string;
  mimeType: string;
};

export type DocumentExtractionQueue = {
  /** Queues the month's documents that still need reading; returns how many were added. */
  enqueueMonth(companyId: number, monthKey: string): number;
  onIdle(): Promise<void>;
};

/**
 * One queue for the whole app: a document is read once at a time, and no more
 * run at once than the model server has slots — three concurrent requests to a
 * one-slot server only waited in its queue with their deadlines running.
 * Receipts are queued first; most are one eKasa lookup.
 */
export function createDocumentExtractionQueue(
  deps: CashDiscoveryDeps,
  concurrency = 1,
): DocumentExtractionQueue {
  const queue = new KeyedQueue<ExtractionJob>(async (job) => {
    try {
      const fileBytes = await deps.driveClient.download(job.driveFileId);
      const input = { ...job, fileBytes };
      if (job.kind === "receipt") {
        await processCashReceiptFile(input, deps);
      } else {
        await processModelExtractionFile(input, deps);
      }
    } catch (error) {
      recordExtractionCrash(job.driveFileId, error);
    }
  }, concurrency);

  return {
    enqueueMonth(companyId, monthKey) {
      if (assertMonthEditable(companyId, monthKey)) {
        return 0;
      }
      ensureDocumentsForMonth(companyId, monthKey, deps.now?.() ?? new Date().toISOString());
      const candidates = [
        ...listCashReceiptCandidates(companyId, monthKey).map((file) => ({ ...file, kind: "receipt" as const })),
        ...listModelExtractionCandidates(companyId, monthKey).map((file) => ({ ...file, kind: "document" as const })),
      ];
      let added = 0;
      for (const file of candidates) {
        if (!needsExtraction(getDocument(file.driveFileId))) {
          continue;
        }
        const job: ExtractionJob = {
          kind: file.kind,
          companyId,
          monthKey,
          driveFileId: file.driveFileId,
          folderSlot: file.folderSlot,
          mimeType: file.mimeType,
        };
        if (queue.enqueue(file.driveFileId, job)) {
          beginExtractionAttempt(file.driveFileId);
          added += 1;
        }
      }
      return added;
    },
    onIdle: () => queue.onIdle(),
  };
}

export function extractionConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.EXTRACTOR_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? value : 1;
}
