import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpExtractor } from "../../../src/adapters/extractor/http-extractor.ts";

/** A complete answer, split into the content deltas the server streams. */
const ANSWER = JSON.stringify({
  parties: [],
  documentNumber: "2026081",
  variableSymbol: null,
  issueDate: null,
  taxableSupplyDate: null,
  dueDate: null,
  currency: "EUR",
  totalLiteral: null,
  vatRecap: [],
  docTypeHint: null,
});
const ANSWER_PARTS = [ANSWER.slice(0, 20), ANSWER.slice(20, 90), ANSWER.slice(90)];

const CHUNK = {
  id: "chatcmpl-7f3a",
  object: "chat.completion.chunk",
  created: 1_790_000_000,
  model: "qwen3-4b",
};

/** One line of a llama.cpp stream: the server's own chunk, as it arrives. */
function chunk(fields: Record<string, unknown>) {
  return { ...CHUNK, ...fields };
}

function delta(content: string | null) {
  return { choices: [{ index: 0, finish_reason: null, delta: { content } }] };
}

function promptRead(processed: number, timeMs: number) {
  return chunk({
    choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: null } }],
    prompt_progress: { total: 1087, cache: 0, processed, time_ms: timeMs },
  });
}

/**
 * A stream recorded from llama.cpp (`--jinja`, `return_progress`,
 * `stream_options.include_usage`) for a 1,087-token prompt: the prompt
 * progress, the answer, then the final chunk with usage and its `timings`.
 */
const RECORDED_STREAM = [
  promptRead(0, 0),
  promptRead(1024, 26_900),
  promptRead(1087, 28_400),
  ...ANSWER_PARTS.map((part) => delta(part)),
  chunk({ choices: [{ index: 0, finish_reason: "stop", delta: {} }] }),
  chunk({
    choices: [],
    usage: { completion_tokens: 332, prompt_tokens: 1087, total_tokens: 1419 },
    timings: {
      cache_n: 0,
      prompt_n: 1087,
      prompt_ms: 28_400.5,
      prompt_per_token_ms: 26.13,
      prompt_per_second: 38.27,
      predicted_n: 332,
      predicted_ms: 45_400.2,
      predicted_per_token_ms: 136.75,
      predicted_per_second: 7.31,
    },
  }),
];

/**
 * A stream whose chunks arrive at the times given: the clock is moved to each
 * chunk's time as the reader asks for it, as a socket would deliver it.
 */
function timedStream(events: Array<{ at: number; event: unknown }>, clock: { now: number }): Response {
  let next = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const step = events[next++];
        if (!step) {
          controller.close();
          return;
        }
        clock.now = step.at;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(step.event)}\n\n`));
      },
    },
    // Pull only when a read is waiting, so the clock is never ahead of the chunk being read.
    { highWaterMark: 0 },
  );
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function eventStream(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(body);
  // Split mid-line, as a socket delivers it.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 7) {
        controller.enqueue(bytes.slice(offset, offset + 7));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function plainResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const INPUT = { driveFileId: "d", monthKey: "2026_01", textLines: ["x"] };

test("llama.cpp's own timings are read from the recorded stream, and win over the clock", async () => {
  const clock = { now: 7 };
  const extractor = createHttpExtractor({
    baseUrl: "http://127.0.0.1:8080",
    model: "qwen3-4b",
    clock: () => clock.now,
    fetchImpl: async () => eventStream(RECORDED_STREAM),
  });

  const result = await extractor.extract({ ...INPUT, onProgress: () => {} });

  assert.deepEqual(result.timing, {
    promptMs: 28_400.5,
    promptTokens: 1087,
    answerMs: 45_400.2,
    answerTokens: 332,
  });
  assert.equal(result.completionTokens, 332);
});

test("without llama.cpp's timings the stream's clock splits the time: the first token ends the prompt", async () => {
  const clock = { now: 1_000 };
  const extractor = createHttpExtractor({
    baseUrl: "http://127.0.0.1:8080",
    model: "m",
    clock: () => clock.now,
    fetchImpl: async () =>
      timedStream(
        [
          { at: 1_500, event: promptRead(0, 500) },
          { at: 4_000, event: delta(ANSWER_PARTS[0]!) },
          { at: 4_500, event: delta(ANSWER_PARTS[1]!) },
          { at: 6_000, event: delta(ANSWER_PARTS[2]!) },
          { at: 9_000, event: delta(null) },
          { at: 9_100, event: { choices: [], usage: { completion_tokens: 3 } } },
        ],
        clock,
      ),
  });

  const result = await extractor.extract({ ...INPUT, onProgress: () => {} });

  // The prompt: the request began at 1,000 and the first token came at 4,000.
  // The answer: the first token to the last, 4,000 to 6,000. The trailing
  // chunks after the last token are not the answer's time.
  assert.deepEqual(result.timing, {
    promptMs: 3_000,
    promptTokens: 1087,
    answerMs: 2_000,
    answerTokens: 3,
  });
});

test("a plain body is timed only when it carries llama.cpp's timings", async () => {
  const answer = { ...JSON.parse(ANSWER), documentNumber: null };
  const timings = { prompt_n: 1087, prompt_ms: 28_400, predicted_n: 332, predicted_ms: 45_400 };
  const withTimings = createHttpExtractor({
    baseUrl: "http://h",
    model: "m",
    fetchImpl: async () => plainResponse({ choices: [{ message: { content: JSON.stringify(answer) } }], timings }),
  });
  const withoutTimings = createHttpExtractor({
    baseUrl: "http://h",
    model: "m",
    fetchImpl: async () => plainResponse({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
  });

  assert.deepEqual((await withTimings.extract(INPUT)).timing, {
    promptMs: 28_400,
    promptTokens: 1087,
    answerMs: 45_400,
    answerTokens: 332,
  });
  // Nothing to split: the body says nothing of its time and was not streamed.
  assert.equal((await withoutTimings.extract(INPUT)).timing, undefined);
});
