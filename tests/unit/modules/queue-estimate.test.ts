import { test } from "node:test";
import assert from "node:assert/strict";
import type { StageTiming } from "../../../src/modules/extraction-timing.ts";
import {
  estimateQueueEmpty,
  estimateText,
  MIN_ESTIMATE_RECORDS,
  type QueueEstimate,
  type QueueEstimateInput,
} from "../../../src/modules/queue-estimate.ts";

/** A record that read a document with the model: a reading half and the model's two stages. */
function modelRecord(promptMs: number, answerMs: number, readingMs = 1_000): { stages: StageTiming[] } {
  return {
    stages: [
      { stage: "download", durationMs: readingMs },
      { stage: "prompt", durationMs: promptMs },
      { stage: "answer", durationMs: answerMs },
    ],
  };
}

/** An eKasa receipt: reading stages only, never the model. */
function receiptRecord(readingMs: number): { stages: StageTiming[] } {
  return { stages: [{ stage: "download", durationMs: readingMs }, { stage: "lookup", durationMs: 0 }] };
}

const records = (count: number, make: () => { stages: StageTiming[] }) => Array.from({ length: count }, make);

const base: QueueEstimateInput = {
  readingWaiting: 0,
  modelWaiting: 0,
  readingConcurrency: 3,
  modelConcurrency: 1,
  records: records(MIN_ESTIMATE_RECORDS, () => modelRecord(20_000, 30_000)),
};

test("an empty queue has nothing to estimate, whatever the records say", () => {
  assert.deepEqual(estimateQueueEmpty(base), { kind: "empty" });
  assert.deepEqual(estimateQueueEmpty({ ...base, records: [] }), { kind: "empty" });
});

test("waiting model documents take the median model time each, on one slot", () => {
  // Five records: prompt+answer 50 s each, so the median is 50 s; 4 waiting = 200 s.
  assert.deepEqual(estimateQueueEmpty({ ...base, modelWaiting: 4 }), { kind: "known", ms: 200_000 });
});

test("the model's slots share the waiting documents: two slots halve the time", () => {
  assert.deepEqual(estimateQueueEmpty({ ...base, modelWaiting: 4, modelConcurrency: 2 }), { kind: "known", ms: 100_000 });
  assert.deepEqual(estimateQueueEmpty({ ...base, modelWaiting: 3, modelConcurrency: 2 }), { kind: "known", ms: 75_000 });
});

test("waiting reading documents take the median reading time, shared by the reading concurrency", () => {
  // Reading only: the receipts' stages are 2 s each; 6 waiting over 3 readers = 4 s.
  const readingOnly = { ...base, records: records(5, () => receiptRecord(2_000)) };
  assert.deepEqual(estimateQueueEmpty({ ...readingOnly, readingWaiting: 6 }), { kind: "known", ms: 4_000 });
});

test("the model part and the reading part are added together", () => {
  // Model 50 s x 2 documents = 100 s. Reading: 1 s (download only) x 3 / 3 = 1 s.
  const both = { ...base, modelWaiting: 2, readingWaiting: 3, records: records(5, () => modelRecord(20_000, 30_000, 1_000)) };
  assert.deepEqual(estimateQueueEmpty(both), { kind: "known", ms: 101_000 });
});

test("the median is the middle record, or the mean of the two middle ones", () => {
  // Model times 10 s, 20 s, 30 s, 40 s, 100 s: median 30 s.
  const odd = [10_000, 20_000, 30_000, 40_000, 100_000].map((ms) => modelRecord(ms, 0));
  assert.deepEqual(estimateQueueEmpty({ ...base, modelWaiting: 1, records: odd }), { kind: "known", ms: 30_000 });
  // Six records: 10 s to 60 s, the two middle ones 30 s and 40 s: median 35 s.
  const even = [10_000, 20_000, 30_000, 40_000, 50_000, 60_000].map((ms) => modelRecord(ms, 0));
  assert.deepEqual(estimateQueueEmpty({ ...base, modelWaiting: 1, records: even }), { kind: "known", ms: 35_000 });
});

test("too few records that timed the model is unknown, with model documents waiting", () => {
  const four = records(MIN_ESTIMATE_RECORDS - 1, () => modelRecord(20_000, 30_000));
  assert.deepEqual(estimateQueueEmpty({ ...base, modelWaiting: 2, records: four }), { kind: "unknown" });
});

test("receipts and records without stages do not count towards the model's sample", () => {
  // Five records, but only four timed the model: unknown.
  const mixed = [...records(4, () => modelRecord(20_000, 30_000)), receiptRecord(2_000), { stages: undefined }];
  assert.deepEqual(estimateQueueEmpty({ ...base, modelWaiting: 1, records: mixed }), { kind: "unknown" });
  // And a receipt never drags the model's median towards zero.
  const withReceipts = [...records(5, () => modelRecord(20_000, 30_000)), ...records(5, () => receiptRecord(2_000))];
  assert.deepEqual(estimateQueueEmpty({ ...base, modelWaiting: 1, records: withReceipts }), { kind: "known", ms: 50_000 });
});

test("too few records with stages is unknown for reading documents waiting", () => {
  const four = records(MIN_ESTIMATE_RECORDS - 1, () => receiptRecord(2_000));
  assert.deepEqual(estimateQueueEmpty({ ...base, readingWaiting: 5, records: four }), { kind: "unknown" });
  assert.deepEqual(estimateQueueEmpty({ ...base, readingWaiting: 5, records: [] }), { kind: "unknown" });
});

test("a part with nothing waiting does not need its records", () => {
  // Only reading documents waiting: the model's records are not asked for, and unknown is not said for the model.
  const readingOnly = { ...base, readingWaiting: 3, records: records(5, () => receiptRecord(2_000)) };
  assert.deepEqual(estimateQueueEmpty({ ...readingOnly, records: [] }), { kind: "unknown" });
  assert.deepEqual(estimateQueueEmpty(readingOnly), { kind: "known", ms: 2_000 });
  // Only model documents waiting: reading records do not matter.
  assert.deepEqual(
    estimateQueueEmpty({ ...base, modelWaiting: 1, records: records(5, () => receiptRecord(2_000)) }),
    { kind: "unknown" },
  );
});

test("the estimate is in minutes and hours, in Slovak", () => {
  assert.equal(estimateText({ kind: "known", ms: 200 * 60_000 + 20_000 }), "približne 3 h 20 min");
  assert.equal(estimateText({ kind: "known", ms: 180 * 60_000 }), "približne 3 h");
  assert.equal(estimateText({ kind: "known", ms: 45 * 60_000 }), "približne 45 min");
  assert.equal(estimateText({ kind: "known", ms: 29_000 }), "menej ako minútu");
  assert.equal(estimateText({ kind: "known", ms: 0 }), "menej ako minútu");
  assert.equal(estimateText({ kind: "unknown" }), "Neznámy");
  assert.equal(estimateText({ kind: "empty" }), null);
});

test("the estimate, row by row: waiting counts, slots and records against the expected answer", () => {
  const fiveModel = records(5, () => modelRecord(20_000, 30_000)); // median 50 s
  const fiveReceipts = records(5, () => receiptRecord(2_000)); // reading median 2 s
  const rows: Array<[string, QueueEstimateInput, QueueEstimate]> = [
    ["nothing waiting", { ...base, records: fiveModel }, { kind: "empty" }],
    ["1 model, 1 slot", { ...base, modelWaiting: 1, records: fiveModel }, { kind: "known", ms: 50_000 }],
    ["4 model, 1 slot", { ...base, modelWaiting: 4, records: fiveModel }, { kind: "known", ms: 200_000 }],
    ["4 model, 2 slots", { ...base, modelWaiting: 4, modelConcurrency: 2, records: fiveModel }, { kind: "known", ms: 100_000 }],
    ["3 model, 2 slots", { ...base, modelWaiting: 3, modelConcurrency: 2, records: fiveModel }, { kind: "known", ms: 75_000 }],
    ["4 model, 4 records", { ...base, modelWaiting: 4, records: fiveModel.slice(0, 4) }, { kind: "unknown" }],
    ["4 model, no records", { ...base, modelWaiting: 4, records: [] }, { kind: "unknown" }],
    ["6 reading, 3 readers", { ...base, readingWaiting: 6, records: fiveReceipts }, { kind: "known", ms: 4_000 }],
    ["6 reading, 4 records", { ...base, readingWaiting: 6, records: fiveReceipts.slice(0, 4) }, { kind: "unknown" }],
    [
      "2 model and 3 reading, both timed",
      { ...base, modelWaiting: 2, readingWaiting: 3, records: [...fiveModel] },
      // Model 2 x 50 s; reading 3 x 1 s over 3 readers.
      { kind: "known", ms: 100_000 + 1_000 },
    ],
    ["model waiting, reading records only", { ...base, modelWaiting: 1, records: fiveReceipts }, { kind: "unknown" }],
  ];
  for (const [label, input, expected] of rows) {
    assert.deepEqual(estimateQueueEmpty(input), expected, label);
  }
});
