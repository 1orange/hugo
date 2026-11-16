import { test } from "node:test";
import assert from "node:assert/strict";
import { askModelSlots, serverRoot } from "../../../src/adapters/extractor/model-slots.ts";

/** A fetch that answers as the server does, and records the URLs asked. */
function fakeFetch(answer: () => Response | Promise<Response>) {
  const asked: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return answer();
  }) as typeof fetch;
  return { fetchImpl, asked };
}

test("the server's total_slots is the model lane's size, asked at the server root and not under /v1", async () => {
  const { fetchImpl, asked } = fakeFetch(() => Response.json({ total_slots: 2, model_path: "x.gguf" }));

  assert.deepEqual(await askModelSlots("http://extractor:8080/v1", { fetchImpl }), { slots: 2 });
  assert.deepEqual(await askModelSlots("http://extractor:8080/v1/", { fetchImpl }), { slots: 2 });
  assert.deepEqual(await askModelSlots("http://extractor:8080", { fetchImpl }), { slots: 2 });
  assert.deepEqual(asked, [
    "http://extractor:8080/props",
    "http://extractor:8080/props",
    "http://extractor:8080/props",
  ]);
});

test("a body without a usable total_slots is a reason, not a size", async () => {
  for (const body of [{}, { total_slots: "2" }, { total_slots: 0 }, { total_slots: 1.5 }, null, "2"]) {
    const { fetchImpl } = fakeFetch(() => Response.json(body));
    const answer = await askModelSlots("http://extractor:8080/v1", { fetchImpl });
    assert.equal(answer.slots, null, `body ${JSON.stringify(body)}`);
    assert.match(answer.slots === null ? answer.reason : "", /total_slots/);
  }
});

test("a body that is not JSON is a reason, not a size", async () => {
  const { fetchImpl } = fakeFetch(() => new Response("<html>not json</html>", { status: 200 }));
  const answer = await askModelSlots("http://extractor:8080/v1", { fetchImpl });
  assert.equal(answer.slots, null);
});

test("a 404 (Ollama has no /props) is a reason, not a size", async () => {
  const { fetchImpl } = fakeFetch(() => new Response("404 page not found", { status: 404 }));
  assert.deepEqual(await askModelSlots("http://ollama:11434/v1", { fetchImpl }), {
    slots: null,
    reason: "HTTP 404",
  });
});

test("a 503 while the model loads is a reason, not a size", async () => {
  const { fetchImpl } = fakeFetch(() => new Response("Loading model", { status: 503 }));
  assert.deepEqual(await askModelSlots("http://extractor:8080/v1", { fetchImpl }), {
    slots: null,
    reason: "HTTP 503",
  });
});

test("a server that is unreachable is a reason, not a size", async () => {
  const { fetchImpl } = fakeFetch(() => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  });
  assert.deepEqual(await askModelSlots("http://extractor:8080/v1", { fetchImpl }), {
    slots: null,
    reason: "ECONNREFUSED",
  });
});

test("a server that does not answer in time is given up on, so startup is not held", async () => {
  // Honours the abort signal, as fetch does: the request never completes on its own.
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;

  const started = Date.now();
  const answer = await askModelSlots("http://extractor:8080/v1", { fetchImpl, timeoutMs: 50 });
  assert.equal(answer.slots, null);
  assert.match(answer.slots === null ? answer.reason : "", /neodpovedá/);
  assert.ok(Date.now() - started < 1000, "the wait is bounded by the timeout");
});

test("the server root drops the /v1 of the OpenAI-style base URL", () => {
  assert.equal(serverRoot("http://extractor:8080/v1"), "http://extractor:8080");
  assert.equal(serverRoot("http://extractor:8080/v1/"), "http://extractor:8080");
  assert.equal(serverRoot("http://extractor:8080"), "http://extractor:8080");
});
