import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatStageDuration,
  quantile,
  stageDetail,
  summarizeStages,
} from "../../../src/modules/extraction-timing.ts";

test("the median and the 90th percentile of each stage, over the records that kept stages", () => {
  const summaries = summarizeStages([
    { stages: [{ stage: "download", durationMs: 400 }, { stage: "answer", durationMs: 45_400 }] },
    { stages: [{ stage: "download", durationMs: 300 }, { stage: "answer", durationMs: 30_000 }] },
    // A record from before stages were kept: its total is all there is.
    {},
    { stages: [{ stage: "download", durationMs: 500 }] },
  ]);

  assert.deepEqual(summaries, [
    { stage: "download", count: 3, medianMs: 400, p90Ms: 480 },
    { stage: "answer", count: 2, medianMs: 37_700, p90Ms: 43_860 },
  ]);
});

test("summaries come in pipeline order, and a stage no record timed is left out", () => {
  const summaries = summarizeStages([
    {
      stages: [
        { stage: "answer", durationMs: 1 },
        { stage: "ocr", durationMs: 2 },
        { stage: "download", durationMs: 3 },
      ],
    },
  ]);
  assert.deepEqual(
    summaries.map((summary) => summary.stage),
    ["download", "ocr", "answer"],
  );
  assert.deepEqual(summarizeStages([{}, { stages: [] }]), []);
});

test("quantiles interpolate between the two ranks around them", () => {
  // Interpolated in floating point, so compared to a micro-unit.
  const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  near(quantile([7], 0.9), 7);
  near(quantile([1, 3], 0.5), 2);
  near(quantile([10, 20, 30, 40], 0.5), 25);
  near(quantile([10, 20, 30, 40], 0.9), 37);
});

test("durations read as seconds with a decimal comma, and as minutes from a minute", () => {
  assert.equal(formatStageDuration(400), "0,4 s");
  assert.equal(formatStageDuration(45_400), "45,4 s");
  assert.equal(formatStageDuration(0), "0,0 s");
  assert.equal(formatStageDuration(76_300), "1:16");
});

test("a stage's count reads in Slovak, with the thousands grouped", () => {
  assert.equal(stageDetail({ stage: "ocr", durationMs: 1, pages: 1 }), "1 strana");
  assert.equal(stageDetail({ stage: "ocr", durationMs: 1, pages: 3 }), "3 strany");
  assert.equal(stageDetail({ stage: "ocr", durationMs: 1, pages: 5 }), "5 strán");
  assert.equal(stageDetail({ stage: "prompt", durationMs: 1, tokens: 1087 }), "1 087 tokenov");
  assert.equal(stageDetail({ stage: "answer", durationMs: 1, tokens: 332 }), "332 tokenov");
  assert.equal(stageDetail({ stage: "download", durationMs: 1 }), null);
});
