import type { Extractor } from "@/adapters/extractor/port";
import type { ModelJobData } from "@/adapters/job-queue/port";
import { finishPipelineReread, recordExtractionCrash } from "@/adapters/store/documents";
import { processModelExtractionFromLines } from "@/lib/model-extraction/process-model-extraction";
import { instrumentExtractor, type ProgressReporter } from "./progress";
import { checkPartiesOfCompleted, settleDocument, type ExtractionJobResult } from "./process-job";

/**
 * Finishes one document in the model lane: the model reads the lines the
 * reading lane handed over, and the checks and the write follow. Neither the
 * download nor OCR happens again. A re-read keeps its prior result until this
 * writes a new one, as in the reading lane. Knows nothing of BullMQ (worker
 * modules).
 */
export async function processModelJob(
  data: ModelJobData,
  deps: { extractor: Extractor; now?: () => string },
  reporter: ProgressReporter,
): Promise<ExtractionJobResult> {
  reporter.carry(data.stages);
  reporter.stage("model");
  let written = true;
  try {
    written = await processModelExtractionFromLines(
      {
        companyId: data.companyId,
        monthKey: data.monthKey,
        driveFileId: data.driveFileId,
        folderSlot: data.folderSlot,
        lines: data.lines,
        source: data.source,
      },
      { extractor: instrumentExtractor(deps.extractor, reporter), now: deps.now },
    );
  } catch (error) {
    await recordExtractionCrash(data.driveFileId, error);
  }

  if (data.priorPayloadJson != null) {
    await finishPipelineReread(data.driveFileId, data.priorPayloadJson, written);
    if (!written) {
      // Nothing was read: the job is tried again when the model is back.
      return { outcome: "waiting", reason: reporter.serviceError ?? "Čaká na model alebo OCR." };
    }
  }
  return checkPartiesOfCompleted(data, await settleDocument(data, reporter.serviceError));
}
