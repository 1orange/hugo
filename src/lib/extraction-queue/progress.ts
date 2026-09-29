import type { ExtractorProgress } from "@/adapters/extractor/port";
import type { CashDiscoveryDeps } from "@/lib/cash-discovery/discover-cash-payments";
import {
  estimateProgressPercent,
  stageLabel,
  type ExtractionStage,
} from "@/modules/extraction-progress";

/** How far one job is, as kept on the job itself (BullMQ progress). */
export type JobProgress = {
  startedAt: number;
  stage: ExtractionStage;
  stageStartedAt: number;
  ocrPages?: number;
  model?: ExtractorProgress;
  /** The bar never goes back when a later stage starts lower (a receipt's QR retry). */
  percentFloor: number;
};

export function percentOf(progress: JobProgress, now: number): number {
  const estimate = estimateProgressPercent({
    stage: progress.stage,
    stageElapsedMs: now - progress.stageStartedAt,
    ocrPages: progress.ocrPages,
    promptTotal: progress.model?.promptTotal,
    promptProcessed: progress.model?.promptProcessed,
    generatedTokens: progress.model?.generatedTokens,
  });
  return Math.max(progress.percentFloor, estimate);
}

export function labelOf(progress: JobProgress): string {
  return stageLabel({
    stage: progress.stage,
    ocrPages: progress.ocrPages,
    promptTotal: progress.model?.promptTotal,
    promptProcessed: progress.model?.promptProcessed,
    generatedTokens: progress.model?.generatedTokens,
  });
}

/** The model streams a token at a time; the job is told at most this often. */
const MODEL_FLUSH_MS = 1000;

/**
 * Collects a job's progress as its adapters are called, and hands it on:
 * at once when the stage changes, at most once a second while the model
 * writes. Also keeps the last error the model or OCR gave — the reason a
 * document that stays pending waits.
 */
export class ProgressReporter {
  private progress: JobProgress;
  private lastFlush = 0;
  private error: string | null = null;

  constructor(
    private readonly flush: (progress: JobProgress) => void,
    private readonly clock: () => number = Date.now,
  ) {
    const now = this.clock();
    this.progress = { startedAt: now, stage: "download", stageStartedAt: now, percentFloor: 0 };
  }

  get current(): JobProgress {
    return this.progress;
  }

  get serviceError(): string | null {
    return this.error;
  }

  stage(stage: ExtractionStage, details: { ocrPages?: number } = {}): void {
    const now = this.clock();
    const floor = percentOf(this.progress, now);
    const changed = this.progress.stage !== stage;
    this.progress = {
      ...this.progress,
      percentFloor: floor,
      ...(changed ? { stage, stageStartedAt: now } : {}),
      ...(details.ocrPages !== undefined ? { ocrPages: details.ocrPages } : {}),
    };
    if (changed) {
      this.emit(now);
    }
  }

  model(progress: ExtractorProgress): void {
    this.progress = { ...this.progress, model: progress };
    const now = this.clock();
    if (now - this.lastFlush >= MODEL_FLUSH_MS) {
      this.emit(now);
    }
  }

  failed(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
  }

  private emit(now: number): void {
    this.lastFlush = now;
    this.flush(this.progress);
  }
}

/**
 * The pipeline's adapters for one job, each reporting its stage as it is
 * called: the pipeline itself knows nothing of the queue. The model's
 * streamed progress and the model's or OCR's errors are passed on too.
 */
export function instrumentDeps(deps: CashDiscoveryDeps, reporter: ProgressReporter): CashDiscoveryDeps {
  const { pdfAccess, qrReader, ekasaLookup, ocr, extractor } = deps;
  const noting = <T>(promise: Promise<T>): Promise<T> =>
    promise.catch((error: unknown) => {
      reporter.failed(error);
      throw error;
    });
  return {
    ...deps,
    pdfAccess: {
      extractTextLines(...args) {
        reporter.stage("text");
        return pdfAccess.extractTextLines(...args);
      },
      extractAttachments(...args) {
        reporter.stage("text");
        return pdfAccess.extractAttachments(...args);
      },
      extractPageImages(...args) {
        reporter.stage("images");
        return pdfAccess.extractPageImages(...args);
      },
    },
    qrReader: {
      readAllCodes(...args) {
        reporter.stage("qr");
        return qrReader.readAllCodes(...args);
      },
    },
    ekasaLookup: {
      findReceipt(...args) {
        reporter.stage("lookup");
        return ekasaLookup.findReceipt(...args);
      },
    },
    ocr: {
      recognize(input) {
        reporter.stage("ocr", { ocrPages: input.images.length });
        return noting(ocr.recognize(input));
      },
    },
    extractor: {
      extract(input) {
        reporter.stage("model");
        return noting(
          extractor.extract({
            ...input,
            onProgress: (progress) => {
              reporter.model(progress);
              input.onProgress?.(progress);
            },
          }),
        );
      },
    },
  };
}
