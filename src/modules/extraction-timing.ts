import { formatElapsed, PAGE_FORMS, TOKEN_FORMS, type ExtractionStage } from "./extraction-progress";
import { pluralSk } from "./format-sk";

/**
 * The stages a finished document's time is split into: the reading lane's
 * adapters (ExtractionStage, without "queued" and "model") and the model's two
 * halves, reading the prompt and writing the answer.
 */
export type TimedStage = Exclude<ExtractionStage, "queued" | "model"> | "prompt" | "answer";

/** The order the stages happen in, so a breakdown reads top to bottom. */
export const TIMED_STAGES: readonly TimedStage[] = [
  "download",
  "text",
  "isdoc",
  "images",
  "qr",
  "lookup",
  "ocr",
  "prompt",
  "answer",
];

export const TIMED_STAGE_LABEL: Record<TimedStage, string> = {
  download: "Sťahovanie z Drive",
  text: "Text PDF",
  isdoc: "ISDOC / MOL",
  images: "Obrázky strán",
  qr: "QR kód eKasa",
  lookup: "Overenie v eKasa",
  ocr: "OCR",
  prompt: "Model číta text",
  answer: "Model píše odpoveď",
};

/** One stage of one document. A stage called twice is one entry: its times add up. */
export type StageTiming = {
  stage: TimedStage;
  durationMs: number;
  /** OCR: the pages it read. */
  pages?: number;
  /** The model: prompt tokens read, or answer tokens written. */
  tokens?: number;
};

/** What a stage's count shows beside its time: "3 strany", "1 087 tokenov". */
export function stageDetail(timing: StageTiming): string | null {
  if (timing.pages !== undefined) {
    return `${timing.pages} ${pluralSk(timing.pages, PAGE_FORMS)}`;
  }
  if (timing.tokens !== undefined) {
    return `${groupThousands(timing.tokens)} ${pluralSk(timing.tokens, TOKEN_FORMS)}`;
  }
  return null;
}

/** "0,4 s", "45,4 s" — seconds with a Slovak decimal comma; from a minute, "1:16". */
export function formatStageDuration(ms: number): string {
  if (ms >= 60_000) {
    return formatElapsed(ms);
  }
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace(".", ",")} s`;
}

function groupThousands(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export type StageSummary = {
  stage: TimedStage;
  /** Records that timed this stage. */
  count: number;
  medianMs: number;
  p90Ms: number;
};

/**
 * The median and the 90th percentile of each stage over the records given, in
 * pipeline order. A record written before stages were kept has none and adds
 * nothing; a stage no record timed is left out.
 */
export function summarizeStages(records: ReadonlyArray<{ stages?: readonly StageTiming[] }>): StageSummary[] {
  const samples = new Map<TimedStage, number[]>();
  for (const record of records) {
    for (const timing of record.stages ?? []) {
      samples.set(timing.stage, [...(samples.get(timing.stage) ?? []), timing.durationMs]);
    }
  }
  return TIMED_STAGES.flatMap((stage) => {
    const values = samples.get(stage);
    if (!values || values.length === 0) {
      return [];
    }
    const sorted = [...values].sort((left, right) => left - right);
    return [
      {
        stage,
        count: sorted.length,
        medianMs: Math.round(quantile(sorted, 0.5)),
        p90Ms: Math.round(quantile(sorted, 0.9)),
      },
    ];
  });
}

/**
 * Linear interpolation between the two ranks around q, as numpy's default: the
 * median of an even count is the mean of its two middle values.
 */
export function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}
