import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpOcr } from "../../../src/adapters/ocr/http-ocr.ts";

test("createHttpOcr posts images and maps boxes", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const ocr = createHttpOcr({
    baseUrl: "http://127.0.0.1:8090",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          boxes: [{ text: "UID: O-ABC", x: 10, y: 20, width: 120, height: 18, page: 0 }],
        }),
        { status: 200 },
      );
    },
  });

  const result = await ocr.recognize({
    images: [{ kind: "encoded", bytes: new Uint8Array([1, 2, 3]) }],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://127.0.0.1:8090/ocr");
  assert.deepEqual(result.boxes, [{ text: "UID: O-ABC", x: 10, y: 20, width: 120, height: 18, page: 0 }]);
});
