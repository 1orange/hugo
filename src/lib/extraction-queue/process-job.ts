import type { ExtractionJobData } from "@/adapters/job-queue/port";
import {
  finalizeReextraction,
  getDocument,
  isReplacementPending,
  recordExtractionCrash,
} from "@/adapters/store/documents";
import { appendCompanySystemEvent } from "@/adapters/store/events";
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

  // Explicit re-extraction writes only to the staging columns. The root job is
  // the commit boundary for every receipt belonging to this Drive file.
  if (await isReplacementPending(data.driveFileId)) {
    const finalized = await finalizeReextraction(
      data.driveFileId,
      reporter.serviceError ?? "Opätovné načítanie dokladu bolo prerušené.",
    );
    if (finalized) {
      await appendCompanySystemEvent(
        new Date().toISOString(),
        data.companyId,
        finalized.outcome === "complete" ? "ReextractionCompleted" : "ReextractionFailed",
        {
          monthKey: data.monthKey,
          driveFileId: data.driveFileId,
          documentId: data.driveFileId,
          documentIds: finalized.documentIds,
          source:
            finalized.sources.length === 1
              ? finalized.sources[0]
              : finalized.sources.length > 1
                ? finalized.sources
                : "manual",
          outcome: finalized.outcome,
          reason: finalized.reason,
        },
      );
      const document = await getDocument(data.driveFileId);
      if (finalized.outcome === "complete") {
        return { outcome: "complete", reason: null };
      }
      return { outcome: "failed", reason: document?.extractionFailureReason ?? finalized.reason };
    }
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
