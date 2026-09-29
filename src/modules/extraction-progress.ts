import { countWithNoun, pluralSk } from "./format-sk";

/**
 * Where a document is on its way through the pipeline, as the queue sees it:
 * each stage is the adapter being called (document-queue), not a step the
 * pipeline announces.
 */
export type ExtractionStage =
  | "queued"
  | "download"
  | "text"
  | "images"
  | "qr"
  | "lookup"
  | "ocr"
  | "model";

export type ProgressInput = {
  stage: ExtractionStage;
  stageElapsedMs: number;
  ocrPages?: number;
  promptTotal?: number;
  promptProcessed?: number;
  generatedTokens?: number;
};

/** An answer is ~330 tokens without thinking (http-extractor). */
export const EXPECTED_ANSWER_TOKENS = 330;

/**
 * Prompt tokens a second on the llama.cpp sidecar, 4 CPU threads, Qwen3 4B
 * Q4_0: 616 tokens in 5.3 s on 2026-09-29. Only paces the bar between the
 * server's coarse prompt updates.
 */
const PROMPT_TOKENS_PER_SECOND = 115;
/** Seconds the OCR sidecar takes for a page; paces the bar, nothing else. */
const OCR_SECONDS_PER_PAGE = 6;

/** Share of the bar each stage starts at; the model is most of the wait. */
const STAGE_START: Record<ExtractionStage, number> = {
  queued: 0,
  download: 2,
  text: 8,
  images: 12,
  qr: 14,
  ocr: 16,
  lookup: 60,
  model: 35,
};
const PROMPT_END = 65;
const ANSWER_END = 98;

/** Rises towards 1 as time passes and never reaches it: a wait with no count. */
function easeTowardsOne(elapsedMs: number, expectedMs: number): number {
  return 1 - Math.exp(-elapsedMs / Math.max(expectedMs, 1));
}

function between(from: number, to: number, fraction: number): number {
  return from + (to - from) * Math.min(Math.max(fraction, 0), 1);
}

/**
 * An estimate of how far one document is, 0–99. The model part counts what
 * the server streams (prompt tokens read, answer tokens written); the rest is
 * paced by time. It reaches 100 only when the document is done.
 */
export function estimateProgressPercent(input: ProgressInput): number {
  const start = STAGE_START[input.stage];
  if (input.stage === "ocr") {
    const expectedMs = OCR_SECONDS_PER_PAGE * 1000 * Math.max(input.ocrPages ?? 1, 1);
    return Math.round(between(start, STAGE_START.model, easeTowardsOne(input.stageElapsedMs, expectedMs)));
  }
  if (input.stage === "lookup") {
    return Math.round(between(start, ANSWER_END, easeTowardsOne(input.stageElapsedMs, 3000)));
  }
  if (input.stage !== "model") {
    return start;
  }

  const generated = input.generatedTokens ?? 0;
  if (generated > 0) {
    return Math.round(between(PROMPT_END, ANSWER_END, generated / EXPECTED_ANSWER_TOKENS));
  }
  const total = input.promptTotal;
  const counted = total && input.promptProcessed ? input.promptProcessed / total : 0;
  const expectedMs = total ? (total / PROMPT_TOKENS_PER_SECOND) * 1000 : 20_000;
  // The server says how far it is only every 2048 tokens; time fills the gaps.
  const paced = easeTowardsOne(input.stageElapsedMs, expectedMs);
  return Math.round(between(start, PROMPT_END, Math.max(counted, paced)));
}

const TOKEN_FORMS = ["token", "tokeny", "tokenov"] as const;
const PAGE_FORMS = ["strana", "strany", "strán"] as const;

export function stageLabel(input: Omit<ProgressInput, "stageElapsedMs">): string {
  switch (input.stage) {
    case "queued":
      return "V rade";
    case "download":
      return "Sťahujem z Drive";
    case "text":
      return "Čítam text PDF";
    case "images":
      return "Pripravujem obrázky strán";
    case "qr":
      return "Hľadám QR kód eKasa";
    case "lookup":
      return "Overujem bloček v eKasa";
    case "ocr":
      return input.ocrPages ? `OCR · ${countWithNoun(input.ocrPages, PAGE_FORMS)}` : "OCR";
    case "model": {
      const generated = input.generatedTokens ?? 0;
      if (generated > 0) {
        return `Model píše odpoveď · ${countWithNoun(generated, TOKEN_FORMS)}`;
      }
      if (input.promptTotal) {
        return `Model číta text · ${input.promptProcessed ?? 0} z ${input.promptTotal} ${pluralSk(input.promptTotal, TOKEN_FORMS)}`;
      }
      return "Model číta text";
    }
  }
}

/** "0:07", "1:12", "12:03" — how long a stage or a job has taken. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
