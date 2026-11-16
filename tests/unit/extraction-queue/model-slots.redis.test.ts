import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Extractor, ExtractorInput, ExtractorOutput } from "../../../src/adapters/extractor/port.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import {
  BullmqExtractionJobQueue,
  closeQueues,
  extractionModelQueue,
  extractionQueue,
  sweepQueue,
} from "../../../src/adapters/job-queue/bullmq-queues.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import { subscribeAppEvents, type AppEvent } from "../../../src/lib/events/bus.ts";
import type { CashDiscoveryDeps } from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import { enqueueMonthExtraction } from "../../../src/lib/extraction-queue/enqueue.ts";
import { loadQueueSnapshot } from "../../../src/lib/extraction-queue/snapshot.ts";
import { closeRedis, redis, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";
import { startExtractionWorker } from "../../../src/lib/worker/extraction-worker.ts";
import { startModelWorker } from "../../../src/lib/worker/model-worker.ts";
import { syntheticEkasaOpdResponse } from "../cash-discovery/synthetic-ekasa-opd.ts";
import { SYNTHETIC_FIXTURE } from "../cash-discovery/synthetic-ekasa-lines.ts";
import { LANE_NOW, OCR_BOXES, pdfFor, DOCS, sweptMonth } from "./lane-fixtures.ts";

/**
 * The model lane sized from the model server's slots, with the real workers and
 * a real Redis: `npm run test:redis`. Skipped otherwise. EXTRACTOR_CONCURRENCY is
 * never set here: the server's `-np` is the setting that counts.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

const MONTH = "2026_01";
const COMPANY = 1;
/** The two documents that need the model: the long invoice, and the scan once OCR has read it. */
const LONG_DOCUMENT = "doc-invoice-a";
const SCANNED = "doc-scan";
const SERVER_ENV = { EXTRACTOR_URL: "http://model.test:8080/v1", EXTRACTOR_MODEL: "local" } as unknown as NodeJS.ProcessEnv;

before(async () => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-slots-${process.pid}`;
});

after(async () => {
  if (!url) {
    return;
  }
  await clearLanes();
  const keys = await redis().keys(`${redisKeyPrefix()}:*`);
  if (keys.length > 0) {
    await redis().del(...keys);
  }
  await closeQueues();
  await closeRedis();
});

async function clearLanes(): Promise<void> {
  await extractionQueue().obliterate({ force: true });
  await extractionModelQueue().obliterate({ force: true });
  await sweepQueue().obliterate({ force: true });
}

/** llama.cpp at `/props`: its slots, or down (no answer at all). */
class FakeModelServer {
  slots: number | null;

  constructor(slots: number | null) {
    this.slots = slots;
  }

  readonly fetch = (async (input: RequestInfo | URL) => {
    if (this.slots === null) {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    }
    if (String(input) !== "http://model.test:8080/props") {
      return new Response("404 page not found", { status: 404 });
    }
    return Response.json({ total_slots: this.slots });
  }) as typeof fetch;
}

/** A model that holds every document until released, and counts the documents it has at once. */
class GatedModel implements Extractor {
  readonly asked: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private open = false;
  private held: Array<() => void> = [];

  async extract(input: ExtractorInput): Promise<ExtractorOutput> {
    this.asked.push(input.driveFileId);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (!this.open) {
        await new Promise<void>((resolve) => this.held.push(resolve));
      }
      return await createStubExtractor().extract(input);
    } finally {
      this.inFlight -= 1;
    }
  }

  releaseAll(): void {
    this.open = true;
    for (const release of this.held.splice(0)) {
      release();
    }
  }
}

/** Every document-read event while the test runs. */
function recordReads() {
  const reads: Array<Extract<AppEvent, { type: "document-read" }>> = [];
  const unsubscribe = subscribeAppEvents((event) => {
    if (event.type === "document-read") {
      reads.push(event);
    }
  });
  return {
    outcomeOf: (driveFileId: string) => reads.filter((read) => read.driveFileId === driveFileId),
    stop: unsubscribe,
  };
}

async function eventually(check: () => boolean | Promise<boolean>, message: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      assert.fail(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The reading lane, as the replicas run it, and the model lane, sized later by each test. */
async function startLanes(model: Extractor) {
  await clearLanes();
  const driveClient = await sweptMonth();
  const deps: CashDiscoveryDeps = {
    driveClient,
    pdfAccess: pdfFor(DOCS),
    qrReader: emptyQrReader(),
    ekasaLookup: new FakeEkasaLookup({
      responses: { [SYNTHETIC_FIXTURE.uid]: { ok: true, raw: syntheticEkasaOpdResponse() } },
    }),
    ocr: new FakeOcr({ boxes: OCR_BOXES }),
    extractor: model,
    now: () => LANE_NOW,
  };
  await extractionQueue().setGlobalConcurrency(3);
  const reading = startExtractionWorker(deps, 3).worker;
  const lane = startModelWorker(model, 1);
  return {
    lane,
    async stop() {
      await Promise.all([reading.close(), lane.worker.close()]);
    },
  };
}

test("with the server reporting 2 slots and EXTRACTOR_CONCURRENCY unset, the model lane reads 2 documents at once", { skip }, async () => {
  const server = new FakeModelServer(2);
  const model = new GatedModel();
  const reads = recordReads();
  const lanes = await startLanes(model);
  try {
    const size = await lanes.lane.resize(SERVER_ENV, server.fetch);
    assert.deepEqual(size, { concurrency: 2, source: "server", reason: null });
    assert.equal(lanes.lane.worker.concurrency, 2);
    assert.equal(await extractionModelQueue().getGlobalConcurrency(), 2);

    await enqueueMonthExtraction(new BullmqExtractionJobQueue(), COMPANY, MONTH);
    await eventually(() => model.asked.length === 2, "the model lane did not take both documents");
    assert.equal(model.inFlight, 2, "both documents are with the model at once");

    const snapshot = await loadQueueSnapshot();
    assert.deepEqual(snapshot.concurrency, { read: 3, model: 2 });
    assert.equal(snapshot.modelSource, "server");

    model.releaseAll();
    await eventually(
      () => reads.outcomeOf(LONG_DOCUMENT).length === 1 && reads.outcomeOf(SCANNED).length === 1,
      "the two documents never finished",
    );
    assert.equal(model.maxInFlight, 2);
  } finally {
    model.releaseAll();
    await lanes.stop();
    reads.stop();
  }
});

test("without the server's answer the fallback holds the model lane to one document, and it is corrected when the server comes back", { skip }, async () => {
  const server = new FakeModelServer(null);
  const model = new GatedModel();
  const reads = recordReads();
  const lanes = await startLanes(model);
  try {
    const down = await lanes.lane.resize(SERVER_ENV, server.fetch);
    assert.equal(down.source, "fallback");
    assert.equal(down.concurrency, 1, "EXTRACTOR_CONCURRENCY unset: one at once");
    assert.match(down.reason ?? "", /ECONNREFUSED/);
    assert.equal(lanes.lane.worker.concurrency, 1);
    assert.equal(await extractionModelQueue().getGlobalConcurrency(), 1);

    await enqueueMonthExtraction(new BullmqExtractionJobQueue(), COMPANY, MONTH);
    await eventually(() => model.asked.length === 1, "the model lane did not take the first document");
    await pause(300);
    assert.equal(model.asked.length, 1, "the second document waits for the fallback's one slot");
    assert.equal(model.maxInFlight, 1);

    // The model server is back with 2 slots: the monitor sizes the lane again.
    server.slots = 2;
    const back = await lanes.lane.resize(SERVER_ENV, server.fetch);
    assert.deepEqual(back, { concurrency: 2, source: "server", reason: null });
    assert.equal(lanes.lane.worker.concurrency, 2);
    assert.equal(await extractionModelQueue().getGlobalConcurrency(), 2);
    const snapshot = await loadQueueSnapshot();
    assert.deepEqual(snapshot.concurrency, { read: 3, model: 2 });
    assert.equal(snapshot.modelSource, "server");

    model.releaseAll();
    await eventually(
      () => reads.outcomeOf(LONG_DOCUMENT).length === 1 && reads.outcomeOf(SCANNED).length === 1,
      "the two documents never finished",
    );
    assert.equal(reads.outcomeOf(LONG_DOCUMENT)[0]!.outcome, "complete");
    assert.equal(reads.outcomeOf(SCANNED)[0]!.outcome, "complete");
  } finally {
    model.releaseAll();
    await lanes.stop();
    reads.stop();
  }
});
