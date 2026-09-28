import type { DriveClient } from "@/adapters/drive/port";
import type { PdfAccess } from "@/adapters/pdf/port";
import type { Extractor } from "@/adapters/extractor/port";
import type { Ocr } from "@/adapters/ocr/port";
import {
  beginExtractionAttempt,
  ensureDocumentsForMonth,
  getDocument,
  recordExtractionCrash,
} from "@/adapters/store/documents";
import { needsExtraction } from "@/modules/extraction-pipeline";
import { listFilesForMonth } from "@/adapters/store/files";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import { RECEIPT_FOLDER_SLOTS } from "@/lib/cash-discovery/discover-cash-payments";
import { isProcessedFolderSlot } from "@/modules/document-state";
import { processModelExtractionFile } from "./process-model-extraction";

export const MODEL_EXTRACTION_FOLDER_PREFIXES = ["01 ", "02 ", "06 "] as const;

const DEFAULT_CONCURRENCY = 3;

export type ModelExtractionDeps = {
  driveClient: DriveClient;
  pdfAccess: PdfAccess;
  ocr: Ocr;
  extractor: Extractor;
  concurrency?: number;
  now?: () => string;
};

function isModelExtractionFolder(folderSlot: string): boolean {
  if ((RECEIPT_FOLDER_SLOTS as readonly string[]).includes(folderSlot)) {
    return false;
  }
  return MODEL_EXTRACTION_FOLDER_PREFIXES.some((prefix) =>
    folderSlot.startsWith(prefix),
  );
}

export function listModelExtractionCandidates(
  companyId: number,
  monthKey: string,
): Array<{
  driveFileId: string;
  name: string;
  mimeType: string;
  folderSlot: string;
}> {
  return listFilesForMonth(companyId, monthKey)
    .filter(
      (file) =>
        !file.deleted &&
        file.folderSlot &&
        isProcessedFolderSlot(file.folderSlot) &&
        isModelExtractionFolder(file.folderSlot) &&
        file.mimeType === "application/pdf",
    )
    .map((file) => ({
      driveFileId: file.driveFileId,
      name: file.name,
      mimeType: file.mimeType,
      folderSlot: file.folderSlot!,
    }));
}

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) {
        await worker(item);
      }
    }
  });
  await Promise.all(runners);
}

export async function discoverModelExtractionForMonth(
  companyId: number,
  monthKey: string,
  deps: ModelExtractionDeps,
): Promise<void> {
  const editable = assertMonthEditable(companyId, monthKey);
  if (editable) {
    return;
  }

  const now = deps.now?.() ?? new Date().toISOString();
  ensureDocumentsForMonth(companyId, monthKey, now);
  const candidates = listModelExtractionCandidates(companyId, monthKey);

  const pending = candidates.filter((file) =>
    needsExtraction(getDocument(file.driveFileId)),
  );

  for (const file of pending) {
    beginExtractionAttempt(file.driveFileId);
  }

  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;

  await runPool(pending, concurrency, async (file) => {
    try {
      const fileBytes = await deps.driveClient.download(file.driveFileId);
      await processModelExtractionFile(
        {
          companyId,
          monthKey,
          driveFileId: file.driveFileId,
          folderSlot: file.folderSlot,
          mimeType: file.mimeType,
          fileBytes,
        },
        {
          pdfAccess: deps.pdfAccess,
          ocr: deps.ocr,
          extractor: deps.extractor,
          now: deps.now,
        },
      );
    } catch (error) {
      recordExtractionCrash(file.driveFileId, error);
    }
  });
}

