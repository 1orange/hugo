import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_ANSWER_TOKENS,
  estimateProgressPercent,
  formatElapsed,
  stageLabel,
} from "../../../src/modules/extraction-progress.ts";

test("a waiting document is at nothing, a download near the start", () => {
  assert.equal(estimateProgressPercent({ stage: "queued", stageElapsedMs: 60_000 }), 0);
  assert.equal(estimateProgressPercent({ stage: "download", stageElapsedMs: 0 }), 2);
});

test("the model's prompt counts from what the server says it has read", () => {
  const start = estimateProgressPercent({ stage: "model", stageElapsedMs: 0, promptTotal: 3000, promptProcessed: 0 });
  const half = estimateProgressPercent({ stage: "model", stageElapsedMs: 0, promptTotal: 3000, promptProcessed: 1500 });
  const read = estimateProgressPercent({ stage: "model", stageElapsedMs: 0, promptTotal: 3000, promptProcessed: 3000 });
  assert.equal(start, 35);
  assert.equal(half, 50);
  assert.equal(read, 65);
});

test("between the server's prompt updates, time moves the bar without passing the prompt's end", () => {
  const early = estimateProgressPercent({ stage: "model", stageElapsedMs: 5_000, promptTotal: 3000 });
  const late = estimateProgressPercent({ stage: "model", stageElapsedMs: 600_000, promptTotal: 3000 });
  assert.ok(early > 35 && early < late, `${early} < ${late}`);
  assert.ok(late <= 65);
});

test("the answer counts its tokens and stops short of done", () => {
  assert.equal(estimateProgressPercent({ stage: "model", stageElapsedMs: 0, generatedTokens: 1 }), 65);
  assert.equal(
    estimateProgressPercent({ stage: "model", stageElapsedMs: 0, generatedTokens: EXPECTED_ANSWER_TOKENS * 3 }),
    98,
  );
});

test("OCR is paced by its pages and ends below the model's start", () => {
  const onePage = estimateProgressPercent({ stage: "ocr", stageElapsedMs: 6_000, ocrPages: 1 });
  const threePages = estimateProgressPercent({ stage: "ocr", stageElapsedMs: 6_000, ocrPages: 3 });
  assert.ok(onePage > threePages);
  assert.ok(estimateProgressPercent({ stage: "ocr", stageElapsedMs: 10 * 60_000, ocrPages: 1 }) <= 35);
});

test("stage labels name what the document waits on, in Slovak", () => {
  assert.equal(stageLabel({ stage: "ocr", ocrPages: 3 }), "OCR · 3 strany");
  assert.equal(
    stageLabel({ stage: "model", promptTotal: 2731, promptProcessed: 2048 }),
    "Model číta text · 2048 z 2731 tokenov",
  );
  assert.equal(stageLabel({ stage: "model", generatedTokens: 3 }), "Model píše odpoveď · 3 tokeny");
});

test("formatElapsed writes minutes and seconds", () => {
  assert.equal(formatElapsed(7_400), "0:07");
  assert.equal(formatElapsed(72_000), "1:12");
});
