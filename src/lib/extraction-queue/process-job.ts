import type { ExtractionJobData } from "@/adapters/job-queue/port";
import { getDocument, recordExtractionCrash } from "@/adapters/store/documents";
import {
  processCashReceiptFile,
  type CashDiscoveryDeps,
} from "@/lib/cash-discovery/discover-cash-payments";
import { processModelExtractionFile } from "@/lib/model-extraction/process-model-extraction";
import { instrumentDeps, type ProgressReporter } from "./progress";
import type { QueueOutcome } from "./types";

export type ExtractionJobResult = { outcome: QueueOutcome; reason: string | null };

/**
 * Reads one file, and says how its document was left: read, failed with a
 * reason, or still waiting — the model or OCR was down, and the job is to be
 * tried again. Knows nothing of BullMQ (worker module).
 */
export async function processExtractionJob(
  data: ExtractionJobData,
  deps: CashDiscoveryDeps,
  reporter: ProgressReporter,
): Promise<ExtractionJobResult> {
  try {
    reporter.stage("download");
    const fileBytes = await deps.driveClient.download(data.driveFileId);
    const input = {
      companyId: data.companyId,
      monthKey: data.monthKey,
      driveFileId: data.driveFileId,
      folderSlot: data.folderSlot,
      mimeType: data.mimeType,
      fileBytes,
    };
    const jobDeps = instrumentDeps(deps, reporter);
    if (data.kind === "receipt") {
      await processCashReceiptFile(input, jobDeps);
    } else {
      await processModelExtractionFile(input, jobDeps);
    }
  } catch (error) {
    await recordExtractionCrash(data.driveFileId, error);
  }

  const document = await getDocument(data.driveFileId);
  if (document?.extractionStatus === "complete") {
    return { outcome: "complete", reason: null };
  }
  if (document?.extractionStatus === "failed") {
    return { outcome: "failed", reason: document.extractionFailureReason };
  }
  return { outcome: "waiting", reason: reporter.serviceError ?? "Čaká na model alebo OCR." };
}
