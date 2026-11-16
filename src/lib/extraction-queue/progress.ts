import type { Extractor, ExtractorProgress, ModelTiming } from "@/adapters/extractor/port";
import type { CashDiscoveryDeps } from "@/lib/cash-discovery/discover-cash-payments";
import {
  estimateProgressPercent,
  stageLabel,
  type ExtractionStage,
} from "@/modules/extraction-progress";
import type { StageTiming, TimedStage } from "@/modules/extraction-timing";

/** The adapters' stages: the ones the reading lane times, each a live stage. */
type AdapterStage = Exclude<TimedStage, "prompt" | "answer">;

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
 * document that stays pending waits — and how long each stage took, which
 * the finished record keeps (Spracovanie).
 */
export class ProgressReporter {
  private progress: JobProgress;
  private lastFlush = 0;
  private error: string | null = null;
  private timings: StageTiming[] = [];

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

  /** The stages timed so far, in the order each first ran. Copies: the caller keeps them. */
  get stages(): StageTiming[] {
    return this.timings.map((timing) => ({ ...timing }));
  }

  /**
   * Runs one adapter call as its stage: the stage is shown while it runs, and
   * its duration is kept even when the call fails, since the time was spent.
   */
  timed<T>(stage: AdapterStage, call: () => Promise<T>, details: { ocrPages?: number } = {}): Promise<T> {
    this.stage(stage, details);
    const started = this.clock();
    return call().finally(() => {
      this.add({
        stage,
        durationMs: this.clock() - started,
        ...(details.ocrPages !== undefined ? { pages: details.ocrPages } : {}),
      });
    });
  }

  /**
   * The model's two halves, as the adapter timed them. Without timing (a server
   * that says nothing of its time) there is nothing to split, and nothing is kept.
   */
  modelTiming(timing: ModelTiming | undefined): void {
    if (!timing) {
      return;
    }
    this.add({
      stage: "prompt",
      durationMs: timing.promptMs,
      ...(timing.promptTokens !== undefined ? { tokens: timing.promptTokens } : {}),
    });
    this.add({
      stage: "answer",
      durationMs: timing.answerMs,
      ...(timing.answerTokens !== undefined ? { tokens: timing.answerTokens } : {}),
    });
  }

  /**
   * Starts from the stages the reading lane timed for this document, when the
   * model lane takes it over: the record then holds the document's stages whichever
   * lane finishes it.
   */
  carry(stages: readonly StageTiming[] = []): void {
    for (const timing of stages) {
      this.add({ ...timing });
    }
  }

  private add(timing: StageTiming): void {
    // A stage called twice in one pass is one entry: its times add up.
    const kept = this.timings.find((entry) => entry.stage === timing.stage);
    if (!kept) {
      this.timings.push(timing);
      return;
    }
    kept.durationMs += timing.durationMs;
    if (timing.pages !== undefined) {
      kept.pages = (kept.pages ?? 0) + timing.pages;
    }
    if (timing.tokens !== undefined) {
      kept.tokens = (kept.tokens ?? 0) + timing.tokens;
    }
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
 * The model's adapter for one job: the stage is the model, its streamed
 * progress is reported, and its errors are kept as the reason a document waits.
 */
export function instrumentExtractor(extractor: Extractor, reporter: ProgressReporter): Extractor {
  return {
    extract(input) {
      reporter.stage("model");
      return extractor.extract({
        ...input,
        onProgress: (progress) => {
          reporter.model(progress);
          input.onProgress?.(progress);
        },
      }).then(
        (output) => {
          reporter.modelTiming(output.timing);
          return output;
        },
        (error: unknown) => {
          reporter.failed(error);
          throw error;
        },
      );
    },
  };
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
        return reporter.timed("text", () => pdfAccess.extractTextLines(...args));
      },
      // An embedded ISDOC or MOL invoice: its own stage, since the time it takes is its own.
      extractAttachments(...args) {
        return reporter.timed("isdoc", () => pdfAccess.extractAttachments(...args));
      },
      extractPageImages(...args) {
        return reporter.timed("images", () => pdfAccess.extractPageImages(...args));
      },
      renderPages(...args) {
        return reporter.timed("images", () => pdfAccess.renderPages(...args));
      },
    },
    qrReader: {
      readAllCodes(...args) {
        return reporter.timed("qr", () => qrReader.readAllCodes(...args));
      },
    },
    ekasaLookup: {
      findReceipt(...args) {
        return reporter.timed("lookup", () => ekasaLookup.findReceipt(...args));
      },
    },
    ocr: {
      recognize(input) {
        return noting(reporter.timed("ocr", () => ocr.recognize(input), { ocrPages: input.images.length }));
      },
    },
    extractor: instrumentExtractor(extractor, reporter),
  };
}
