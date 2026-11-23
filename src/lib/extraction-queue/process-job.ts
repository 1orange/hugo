import type { ExtractionJobData, ModelJobData } from "@/adapters/job-queue/port";
import {
  finalizeReextraction,
  finishPipelineReread,
  getDocument,
  isReplacementPending,
  recordExtractionCrash,
} from "@/adapters/store/documents";
import { appendCompanySystemEvent } from "@/adapters/store/events";
import {
  processCashReceiptFile,
  type CashDiscoveryDeps,
} from "@/lib/cash-discovery/discover-cash-payments";
import {
  processModelExtractionFile,
  type ModelTextInput,
} from "@/lib/model-extraction/process-model-extraction";
import { queueSubjectChecksForFile } from "@/lib/subject-directory/schedule";
import { instrumentDeps, type ProgressReporter } from "./progress";
import type { QueueOutcome } from "./types";

/** "handed": the document is with the model lane, which finishes it. */
export type ExtractionJobResult = { outcome: QueueOutcome | "handed"; reason: string | null };

/**
 * Reads one file in the reading lane — everything but the model — and says how
 * it was left: finished here, handed to the model lane with its text lines
 * (`handOff`), or still waiting for OCR. Without `handOff` the model reads the
 * document here, at once. Once a document is complete its parties are checked
 * against the registers (ADR 0022). Knows nothing of BullMQ (worker modules).
 */
export async function processExtractionJob(
  data: ExtractionJobData,
  deps: CashDiscoveryDeps,
  reporter: ProgressReporter,
  handOff?: (job: ModelJobData) => Promise<boolean>,
): Promise<ExtractionJobResult> {
  const result = await readExtractionJob(data, deps, reporter, handOff);
  return result.outcome === "handed" ? result : checkPartiesOfCompleted(data, result);
}

async function readExtractionJob(
  data: ExtractionJobData,
  deps: CashDiscoveryDeps,
  reporter: ProgressReporter,
  handOff: ((job: ModelJobData) => Promise<boolean>) | undefined,
): Promise<ExtractionJobResult> {
  // A re-read keeps the earlier complete result until a new one is written.
  let priorPayloadJson: string | null = null;
  let written = true;
  let handedOff = false;
  try {
    if (data.reread === true && data.kind === "document") {
      priorPayloadJson = (await getDocument(data.driveFileId))?.extractedPayloadJson ?? null;
    }
    const fileBytes = await reporter.timed("download", () => deps.driveClient.download(data.driveFileId));
    const input = {
      companyId: data.companyId,
      monthKey: data.monthKey,
      driveFileId: data.driveFileId,
      folderSlot: data.folderSlot,
      mimeType: data.mimeType,
      fileBytes,
      reread: priorPayloadJson !== null,
    };
    const jobDeps = {
      ...instrumentDeps(deps, reporter),
      ...(handOff
        ? {
            handOffToModel: async (text: ModelTextInput) => {
              handedOff = true;
              await handOff({
                kind: data.kind,
                companyId: data.companyId,
                companyName: data.companyName,
                monthKey: data.monthKey,
                driveFileId: data.driveFileId,
                fileName: data.fileName,
                folderSlot: data.folderSlot,
                source: text.source ?? "model",
                tier: data.tier,
                lines: text.lines,
                readStartedAt: reporter.current.startedAt,
                stages: reporter.stages,
                enqueuedAt: data.enqueuedAt,
                priorPayloadJson,
              });
            },
          }
        : {}),
    };
    if (data.kind === "receipt") {
      await processCashReceiptFile(input, jobDeps);
    } else {
      written = await processModelExtractionFile(input, jobDeps);
    }
  } catch (error) {
    // A queue that refused the hand-off is no fault of the document: the job
    // fails, and the next queueing reads the document again.
    if (handedOff) {
      throw error;
    }
    await recordExtractionCrash(data.driveFileId, error);
  }

  if (handedOff) {
    return { outcome: "handed", reason: null };
  }
  if (priorPayloadJson !== null) {
    await finishPipelineReread(data.driveFileId, priorPayloadJson, written);
    if (!written) {
      // Nothing was read: the job is tried again when the model or OCR is back.
      return { outcome: "waiting", reason: reporter.serviceError ?? "Čaká na model alebo OCR." };
    }
  }
  return settleDocument(data, reporter.serviceError);
}

/**
 * How a document is left once its lane is done with it: committed or failed,
 * or still pending — the service it needs was down, and the job is to be tried
 * again. A re-read's replacement is committed here, by whichever lane finishes
 * the document; a re-read the lane could not finish keeps its prior result.
 */
export async function settleDocument(
  document: { driveFileId: string; companyId: number; monthKey: string },
  serviceError: string | null,
): Promise<ExtractionJobResult> {
  // Explicit re-extraction writes only to the staging columns. The root job is
  // the commit boundary for every receipt belonging to this Drive file.
  if (await isReplacementPending(document.driveFileId)) {
    const finalized = await finalizeReextraction(
      document.driveFileId,
      serviceError ?? "Opätovné načítanie dokladu bolo prerušené.",
    );
    if (finalized) {
      await appendCompanySystemEvent(
        new Date().toISOString(),
        document.companyId,
        finalized.outcome === "complete" ? "ReextractionCompleted" : "ReextractionFailed",
        {
          monthKey: document.monthKey,
          driveFileId: document.driveFileId,
          documentId: document.driveFileId,
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
      const row = await getDocument(document.driveFileId);
      if (finalized.outcome === "complete") {
        return { outcome: "complete", reason: null };
      }
      return { outcome: "failed", reason: row?.extractionFailureReason ?? finalized.reason };
    }
  }

  const row = await getDocument(document.driveFileId);
  if (row?.extractionStatus === "complete") {
    return { outcome: "complete", reason: null };
  }
  if (row?.extractionStatus === "failed") {
    return { outcome: "failed", reason: row.extractionFailureReason };
  }
  return { outcome: "waiting", reason: serviceError ?? "Čaká na model alebo OCR." };
}

/**
 * A complete document's parties are checked against the registers, whichever
 * lane finished it. Queuing them never fails the job: the next page render
 * queues what is missing.
 */
export async function checkPartiesOfCompleted(
  data: { driveFileId: string },
  result: ExtractionJobResult,
): Promise<ExtractionJobResult> {
  if (result.outcome === "complete") {
    await queueSubjectChecksForFile(data.driveFileId).catch((error: unknown) =>
      console.warn(`[subject] could not queue the party checks for ${data.driveFileId}`, error),
    );
  }
  return result;
}
