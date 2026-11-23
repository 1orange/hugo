import { quantile, type StageTiming } from "./extraction-timing";

/**
 * Fewer recent documents than this and the estimate says so: a median of two or
 * three records swings with one slow invoice, and the queue page would promise
 * a time it cannot keep.
 */
export const MIN_ESTIMATE_RECORDS = 5;

/** The model's two stages: reading the prompt and writing the answer. */
const MODEL_STAGES: ReadonlySet<string> = new Set(["prompt", "answer"]);

export type QueueEstimate =
  /** Nothing is waiting in either lane. */
  | { kind: "empty" }
  /** Too few recent records to say; the screen shows "Neznámy". */
  | { kind: "unknown" }
  | { kind: "known"; ms: number };

export type QueueEstimateInput = {
  /** Documents waiting in the reading lane (queued, or delayed for OCR). */
  readingWaiting: number;
  /** Documents waiting for the model (queued, or delayed for the model). */
  modelWaiting: number;
  /** Documents the reading lane reads at once, across every worker. */
  readingConcurrency: number;
  /** Documents the model reads at once: the model server's slots. */
  modelConcurrency: number;
  /** Recent finished records; one without stages (written before they were kept) adds nothing. */
  records: ReadonlyArray<{ stages?: readonly StageTiming[] }>;
};

/**
 * Milliseconds the records spent with the model: prompt plus answer. Null for a
 * record that never reached the model (an eKasa receipt), which must not drag
 * the median towards zero.
 */
function modelMsOf(stages: readonly StageTiming[] | undefined): number | null {
  const model = (stages ?? []).filter((timing) => MODEL_STAGES.has(timing.stage));
  return model.length === 0 ? null : model.reduce((sum, timing) => sum + timing.durationMs, 0);
}

/** Milliseconds a record spent in the reading lane: every stage but the model's. Null without stages. */
function readingMsOf(stages: readonly StageTiming[] | undefined): number | null {
  if (!stages || stages.length === 0) {
    return null;
  }
  return stages
    .filter((timing) => !MODEL_STAGES.has(timing.stage))
    .reduce((sum, timing) => sum + timing.durationMs, 0);
}

function medianOf(values: readonly number[]): number {
  return quantile([...values].sort((left, right) => left - right), 0.5);
}

/**
 * When the queue will be empty: the waiting model documents, each taking the
 * median model time of the recent records, shared by the model's slots; plus the
 * waiting reading documents, each taking the median reading time, shared by the
 * reading concurrency. The two parts are added, as the queue page has always
 * described them, not taken as the longer of the two lanes.
 *
 * A part that has work waiting needs MIN_ESTIMATE_RECORDS records that timed it,
 * or the estimate is unknown. A part with nothing waiting asks for nothing.
 *
 * Pure: the counts, the slots and the records are the whole input.
 */
export function estimateQueueEmpty(input: QueueEstimateInput): QueueEstimate {
  if (input.readingWaiting <= 0 && input.modelWaiting <= 0) {
    return { kind: "empty" };
  }

  let ms = 0;
  if (input.modelWaiting > 0) {
    const samples = input.records.flatMap((record) => {
      const value = modelMsOf(record.stages);
      return value === null ? [] : [value];
    });
    if (samples.length < MIN_ESTIMATE_RECORDS) {
      return { kind: "unknown" };
    }
    ms += (input.modelWaiting * medianOf(samples)) / Math.max(1, input.modelConcurrency);
  }

  if (input.readingWaiting > 0) {
    const samples = input.records.flatMap((record) => {
      const value = readingMsOf(record.stages);
      return value === null ? [] : [value];
    });
    if (samples.length < MIN_ESTIMATE_RECORDS) {
      return { kind: "unknown" };
    }
    ms += (input.readingWaiting * medianOf(samples)) / Math.max(1, input.readingConcurrency);
  }

  return { kind: "known", ms: Math.round(ms) };
}

/**
 * The estimate as the queue page says it: "približne 3 h 20 min", "Neznámy". Null
 * when the queue is empty, because then there is nothing to estimate.
 *
 * Minutes are rounded to the minute; under half a minute reads as "menej ako
 * minútu". Hours and minutes are not plural-inflected, so "h" and "min" stay as
 * they are in Slovak UI.
 */
export function estimateText(estimate: QueueEstimate): string | null {
  switch (estimate.kind) {
    case "empty":
      return null;
    case "unknown":
      return "Neznámy";
    case "known": {
      const minutes = Math.round(estimate.ms / 60_000);
      if (minutes < 1) {
        return "menej ako minútu";
      }
      if (minutes < 60) {
        return `približne ${minutes} min`;
      }
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest === 0 ? `približne ${hours} h` : `približne ${hours} h ${rest} min`;
    }
  }
}
