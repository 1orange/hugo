import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseModelLaneSize, fallbackModelConcurrency } from "../../../src/lib/worker/model-lane-size.ts";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

const neverAsked = (async () => {
  throw new Error("the model server must not be asked");
}) as typeof fetch;

test("the fallback is EXTRACTOR_CONCURRENCY when it is a positive whole number, or 1", () => {
  assert.equal(fallbackModelConcurrency(env({})), 1);
  assert.equal(fallbackModelConcurrency(env({ EXTRACTOR_CONCURRENCY: "4" })), 4);
  assert.equal(fallbackModelConcurrency(env({ EXTRACTOR_CONCURRENCY: "0" })), 1);
  assert.equal(fallbackModelConcurrency(env({ EXTRACTOR_CONCURRENCY: "2.5" })), 1);
  assert.equal(fallbackModelConcurrency(env({ EXTRACTOR_CONCURRENCY: "many" })), 1);
});

test("the server's slots size the lane, whatever EXTRACTOR_CONCURRENCY says", async () => {
  const fetchImpl = (async () => Response.json({ total_slots: 2 })) as typeof fetch;
  assert.deepEqual(
    await chooseModelLaneSize(env({ EXTRACTOR_URL: "http://model.test:8080/v1", EXTRACTOR_CONCURRENCY: "5" }), fetchImpl),
    { concurrency: 2, source: "server", reason: null },
  );
});

test("when the server does not answer, the fallback sizes the lane and says why", async () => {
  const fetchImpl = (async () => new Response("404 page not found", { status: 404 })) as typeof fetch;
  assert.deepEqual(
    await chooseModelLaneSize(env({ EXTRACTOR_URL: "http://ollama.test:11434/v1", EXTRACTOR_CONCURRENCY: "3" }), fetchImpl),
    { concurrency: 3, source: "fallback", reason: "HTTP 404" },
  );
});

test("with no model server (the stub, the fake Drive, or no URL) the server is not asked and the fallback holds", async () => {
  assert.deepEqual(
    await chooseModelLaneSize(env({ EXTRACTOR: "stub", EXTRACTOR_URL: "http://model.test:8080/v1" }), neverAsked),
    { concurrency: 1, source: "fallback", reason: "model sa nečíta zo servera" },
  );
  assert.equal((await chooseModelLaneSize(env({ DRIVE_CLIENT: "fake", EXTRACTOR_URL: "http://model.test:8080/v1" }), neverAsked)).source, "fallback");
  assert.deepEqual(await chooseModelLaneSize(env({ EXTRACTOR_CONCURRENCY: "2" }), neverAsked), {
    concurrency: 2,
    source: "fallback",
    reason: "model sa nečíta zo servera",
  });
});
