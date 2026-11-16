import { test } from "node:test";
import assert from "node:assert/strict";
import type { Extractor, ExtractorOutput } from "../../../src/adapters/extractor/port.ts";
import type { CashDiscoveryDeps } from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import { instrumentDeps, instrumentExtractor, ProgressReporter } from "../../../src/lib/extraction-queue/progress.ts";

/** A clock the test moves: the adapters below spend time by moving it. */
function fakeClock(start: number) {
  let now = start;
  return {
    now: () => now,
    spend: (ms: number) => {
      now += ms;
    },
  };
}

const EMPTY_PAYLOAD = { kind: "extracted", source: "model", parties: [], vatRecap: [] } as never;

test("each adapter's time is kept under its stage, in the order the stages first ran", async () => {
  const clock = fakeClock(1000);
  const reporter = new ProgressReporter(() => {}, clock.now);
  const deps = instrumentDeps(
    {
      pdfAccess: {
        extractTextLines: async () => {
          clock.spend(300);
          return [];
        },
        extractAttachments: async () => {
          clock.spend(20);
          return [];
        },
        extractPageImages: async () => {
          clock.spend(100);
          return [];
        },
        renderPages: async () => {
          clock.spend(600);
          return [];
        },
      },
      qrReader: {
        readAllCodes: async () => {
          clock.spend(50);
          return [];
        },
      },
      ekasaLookup: {
        findReceipt: async () => {
          clock.spend(10);
          return { ok: false };
        },
      },
      ocr: {
        recognize: async () => {
          clock.spend(4000);
          return { text: [] };
        },
      },
    } as unknown as CashDiscoveryDeps,
    reporter,
  );

  await deps.pdfAccess.extractTextLines(new Uint8Array(), {} as never);
  await deps.pdfAccess.extractAttachments(new Uint8Array());
  await deps.pdfAccess.extractPageImages(new Uint8Array());
  await deps.pdfAccess.renderPages(new Uint8Array(), {} as never);
  await deps.qrReader.readAllCodes({} as never);
  await deps.ekasaLookup.findReceipt("uid");
  // A stage called again in the same pass adds its time to the one kept.
  await deps.pdfAccess.extractTextLines(new Uint8Array(), {} as never);
  await deps.ocr.recognize({ images: [{}, {}] } as never);

  assert.deepEqual(reporter.stages, [
    { stage: "text", durationMs: 600 },
    { stage: "isdoc", durationMs: 20 },
    { stage: "images", durationMs: 700 },
    { stage: "qr", durationMs: 50 },
    { stage: "lookup", durationMs: 10 },
    { stage: "ocr", durationMs: 4000, pages: 2 },
  ]);
  assert.equal(reporter.current.stage, "ocr");
  assert.equal(reporter.current.ocrPages, 2);
});

test("a failing call keeps the time it took, and its error is the reason a document waits", async () => {
  const clock = fakeClock(0);
  const reporter = new ProgressReporter(() => {}, clock.now);
  const deps = instrumentDeps(
    {
      ocr: {
        recognize: async () => {
          clock.spend(2000);
          throw new Error("OCR is unreachable.");
        },
      },
    } as unknown as CashDiscoveryDeps,
    reporter,
  );

  await assert.rejects(deps.ocr.recognize({ images: [{}] } as never), /OCR is unreachable/);
  assert.deepEqual(reporter.stages, [{ stage: "ocr", durationMs: 2000, pages: 1 }]);
  assert.equal(reporter.serviceError, "OCR is unreachable.");
});

test("the model's prompt and answer are kept with their tokens, as the adapter timed them", async () => {
  const extractor: Extractor = {
    async extract(): Promise<ExtractorOutput> {
      return {
        payload: EMPTY_PAYLOAD,
        durationMs: 73_800,
        timing: { promptMs: 28_400, promptTokens: 1087, answerMs: 45_400, answerTokens: 332 },
      };
    },
  };
  const reporter = new ProgressReporter(() => {});
  const output = await instrumentExtractor(extractor, reporter).extract({
    driveFileId: "d",
    monthKey: "2026_01",
    textLines: [],
  });

  assert.equal(output.durationMs, 73_800);
  assert.deepEqual(reporter.stages, [
    { stage: "prompt", durationMs: 28_400, tokens: 1087 },
    { stage: "answer", durationMs: 45_400, tokens: 332 },
  ]);
});

test("a model that says nothing of its time keeps no prompt or answer", async () => {
  const extractor: Extractor = {
    async extract() {
      return { payload: EMPTY_PAYLOAD, durationMs: 9000 };
    },
  };
  const reporter = new ProgressReporter(() => {});
  await instrumentExtractor(extractor, reporter).extract({ driveFileId: "d", monthKey: "2026_01", textLines: [] });
  assert.deepEqual(reporter.stages, []);
});

test("the reading lane's stages are carried into the model lane's reporter, and the model's are added", () => {
  const carried = [
    { stage: "download" as const, durationMs: 400 },
    { stage: "text" as const, durationMs: 1200 },
  ];
  const reader = new ProgressReporter(() => {});
  reader.carry(carried);
  reader.modelTiming({ promptMs: 28_400, promptTokens: 1087, answerMs: 45_400, answerTokens: 332 });

  assert.deepEqual(reader.stages, [
    ...carried,
    { stage: "prompt", durationMs: 28_400, tokens: 1087 },
    { stage: "answer", durationMs: 45_400, tokens: 332 },
  ]);
  // The carried stages are copies: the model lane's additions do not reach the reading lane's.
  reader.carry([{ stage: "download", durationMs: 1 }]);
  assert.equal(carried[0]!.durationMs, 400);
});
