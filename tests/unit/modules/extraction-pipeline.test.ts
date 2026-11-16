import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRACTION_PIPELINE_VERSION,
  needsExtraction,
  needsPipelineReread,
} from "../../../src/modules/extraction-pipeline.ts";

test("a new or pending document needs extraction", () => {
  assert.equal(needsExtraction(undefined), true);
  assert.equal(
    needsExtraction({ extractionStatus: "pending", extractionPipelineVersion: null }),
    true,
  );
});

test("a failure from before versions were recorded is retried", () => {
  // The spring scans that failed "no extractable text layer" before QR decoding existed.
  assert.equal(
    needsExtraction({ extractionStatus: "failed", extractionPipelineVersion: null }),
    true,
  );
});

test("a failure from an older pipeline is retried", () => {
  assert.equal(
    needsExtraction({
      extractionStatus: "failed",
      extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION - 1,
    }),
    true,
  );
});

test("a failure under the current pipeline is not retried", () => {
  assert.equal(
    needsExtraction({
      extractionStatus: "failed",
      extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION,
    }),
    false,
  );
});

test("a complete document is never re-read, whatever its version", () => {
  assert.equal(
    needsExtraction({ extractionStatus: "complete", extractionPipelineVersion: null }),
    false,
  );
});

test("an undecided complete result from an older pipeline is read again", () => {
  for (const version of [EXTRACTION_PIPELINE_VERSION - 1, null]) {
    assert.equal(
      needsPipelineReread({
        extractionStatus: "complete",
        extractionPipelineVersion: version,
        decision: null,
        exportedAt: null,
        replacementPending: false,
      }),
      true,
      `version ${version}`,
    );
  }
});

test("a complete result under the current pipeline is not read again", () => {
  assert.equal(
    needsPipelineReread({
      extractionStatus: "complete",
      extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION,
      decision: null,
      exportedAt: null,
      replacementPending: false,
    }),
    false,
  );
});

test("decided, exported and staged documents are never read again by a pipeline upgrade", () => {
  const base = {
    extractionStatus: "complete",
    extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION - 1,
    decision: null,
    exportedAt: null,
    replacementPending: false,
  };
  assert.equal(needsPipelineReread({ ...base, decision: "confirmed" }), false);
  assert.equal(needsPipelineReread({ ...base, decision: "not_relevant" }), false);
  assert.equal(needsPipelineReread({ ...base, exportedAt: "2026-05-02T10:00:00.000Z" }), false);
  assert.equal(needsPipelineReread({ ...base, replacementPending: true }), false);
});

test("only complete results are candidates for a pipeline re-read", () => {
  assert.equal(
    needsPipelineReread({
      extractionStatus: "failed",
      extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION - 1,
      decision: null,
      exportedAt: null,
      replacementPending: false,
    }),
    false,
  );
  assert.equal(needsPipelineReread(undefined), false);
});
