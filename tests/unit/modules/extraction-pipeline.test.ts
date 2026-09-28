import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRACTION_PIPELINE_VERSION,
  needsExtraction,
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
