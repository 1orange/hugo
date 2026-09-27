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
