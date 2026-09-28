import { test } from "node:test";
import assert from "node:assert/strict";
import { createExtractor } from "../../../src/adapters/extractor/create-extractor.ts";

test("createExtractor uses stub when EXTRACTOR=stub", async () => {
  const extractor = createExtractor({
    EXTRACTOR: "stub",
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);
  const result = await extractor.extract({
    driveFileId: "d",
    monthKey: "2026_05",
    textLines: [],
  });
  assert.equal(result.payload.kind, "extracted");
  assert.deepEqual(result.payload.parties, []);
});

// Without an endpoint, development used to fall back to the stub, which marked
// 44 of her real invoices complete with empty fields — and complete documents
// are never read again. Unconfigured now means "not reachable": they wait.
test("createExtractor without an endpoint behaves as unreachable, not as a stub", async () => {
  const { isExtractorUnreachableError } = await import(
    "../../../src/lib/model-extraction/process-model-extraction.ts"
  );
  const extractor = createExtractor({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
  await assert.rejects(
    extractor.extract({ driveFileId: "d", monthKey: "2026_05", textLines: [] }),
    (error: unknown) => isExtractorUnreachableError(error),
  );
});

test("createExtractor still stubs when the e2e fake Drive asks for it", async () => {
  const extractor = createExtractor({ DRIVE_CLIENT: "fake", NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const result = await extractor.extract({ driveFileId: "d", monthKey: "2026_05", textLines: [] });
  assert.equal(result.payload.kind, "extracted");
});
