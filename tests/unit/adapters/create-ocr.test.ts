import { test } from "node:test";
import assert from "node:assert/strict";
import { createOcr } from "../../../src/adapters/ocr/create-ocr.ts";
import { isOcrUnreachableError } from "../../../src/lib/ocr/document-ocr.ts";

// Without OCR_URL, development used a fake that read nothing, so image
// documents were marked failed and not retried once OCR was configured.
test("createOcr without an endpoint behaves as unreachable, not as a fake", async () => {
  const ocr = createOcr({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
  await assert.rejects(ocr.recognize({ images: [] }), (error: unknown) =>
    isOcrUnreachableError(error),
  );
});

test("createOcr fakes only when asked", async () => {
  for (const env of [{ OCR: "fake" }, { DRIVE_CLIENT: "fake" }]) {
    const ocr = createOcr({ ...env, NODE_ENV: "test" } as NodeJS.ProcessEnv);
    const result = await ocr.recognize({ images: [] });
    assert.ok(Array.isArray(result.boxes));
  }
});
