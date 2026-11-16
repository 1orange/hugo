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
import { DOCUMENT_PRIORITY, type ExtractionJobData } from "../../../src/adapters/job-queue/port.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import type { Ocr, OcrInput, OcrOutput } from "../../../src/adapters/ocr/port.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import { subscribeAppEvents, type AppEvent } from "../../../src/lib/events/bus.ts";
import type { CashDiscoveryDeps } from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import { enqueueMonthExtraction } from "../../../src/lib/extraction-queue/enqueue.ts";
import { loadQueueSnapshot } from "../../../src/lib/extraction-queue/snapshot.ts";
import { closeRedis, redis, redisKey, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";
import { startExtractionWorker } from "../../../src/lib/worker/extraction-worker.ts";
import { startModelWorker } from "../../../src/lib/worker/model-worker.ts";
import { syntheticEkasaOpdResponse } from "../cash-discovery/synthetic-ekasa-opd.ts";
import { SYNTHETIC_FIXTURE } from "../cash-discovery/synthetic-ekasa-lines.ts";
import { DOCS, LANE_NOW, OCR_BOXES, pdfFor, SLOT_02, sweptMonth } from "./lane-fixtures.ts";

/**
 * The two lanes as the replicas share them, with the real workers and a real
 * Redis: `npm run test:redis` (TEST_REDIS_URL, e.g. the compose one). Skipped
 * otherwise. The model is a fake that holds a document as long as a test needs.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

const MONTH = "2026_01";
const COMPANY = 1;
const LONG_DOCUMENT = "doc-invoice-a";
const ISDOC = "doc-isdoc";
const SCANNED = "doc-scan";
const RECEIPT = "doc-receipt";

before(async () => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-lanes-${process.pid}`;
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
  await redis().del(redisKey("extraction", "recent"));
}

/** A model that holds one document until released, and can be made to be down. */
class HeldModel implements Extractor {
  readonly asked: string[] = [];
  down = false;
  private readonly gate: Promise<void>;
  private open!: () => void;

  constructor(private readonly held: string) {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  release(): void {
    this.open();
  }

  async extract(input: ExtractorInput): Promise<ExtractorOutput> {
    this.asked.push(input.driveFileId);
    if (this.down) {
      throw new Error("Extractor is unreachable: EXTRACTOR_URL and EXTRACTOR_MODEL are not set.");
    }
    if (input.driveFileId === this.held) {
      await this.gate;
    }
    return createStubExtractor().extract(input);
  }
}

/** OCR that can be made to be down, as the sidecar is when its container restarts. */
class SwitchableOcr implements Ocr {
  down = true;
  private readonly inner = new FakeOcr({ boxes: OCR_BOXES });
  readonly calls: OcrInput[] = [];

  async recognize(input: OcrInput): Promise<OcrOutput> {
    this.calls.push(input);
    if (this.down) {
      throw new Error("OCR is unreachable.");
    }
    return this.inner.recognize(input);
  }
}

/** Every document-read event while the test runs: the screens hear each one once. */
function recordReads() {
  const reads: Array<Extract<AppEvent, { type: "document-read" }>> = [];
  const unsubscribe = subscribeAppEvents((event) => {
    if (event.type === "document-read") {
      reads.push(event);
    }
  });
  return {
    reads,
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

/** Both lanes, with the fakes; the reading lane takes three at once, the model one. */
async function startLanes(options: { extractor: Extractor; ocr: Ocr }) {
  await clearLanes();
  const driveClient = await sweptMonth();
  const deps: CashDiscoveryDeps = {
    driveClient,
    pdfAccess: pdfFor(DOCS),
    qrReader: emptyQrReader(),
    ekasaLookup: new FakeEkasaLookup({
      responses: { [SYNTHETIC_FIXTURE.uid]: { ok: true, raw: syntheticEkasaOpdResponse() } },
    }),
    ocr: options.ocr,
    extractor: options.extractor,
    now: () => LANE_NOW,
  };
  await extractionQueue().setGlobalConcurrency(3);
  await extractionModelQueue().setGlobalConcurrency(1);
  const reading = startExtractionWorker(deps, 3).worker;
  const modelling = startModelWorker(options.extractor, 1).worker;
  return {
    async stop() {
      await Promise.all([reading.close(), modelling.close()]);
    },
  };
}

/** The document the reading lane hands over first, by hand, as the first queueing does. */
function longDocumentJob(): ExtractionJobData {
  return {
    kind: "document",
    companyId: COMPANY,
    companyName: "Delta s.r.o.",
    monthKey: MONTH,
    driveFileId: LONG_DOCUMENT,
    fileName: `${LONG_DOCUMENT}.pdf`,
    folderSlot: SLOT_02,
    mimeType: "application/pdf",
    enqueuedAt: new Date().toISOString(),
  };
}

test("while the model is busy on one document, an eKasa receipt and an ISDOC invoice queued after it finish first", { skip }, async () => {
  const model = new HeldModel(LONG_DOCUMENT);
  const reads = recordReads();
  const lanes = await startLanes({ extractor: model, ocr: new FakeOcr({ boxes: OCR_BOXES }) });
  try {
    assert.equal(await new BullmqExtractionJobQueue().add(longDocumentJob(), { priority: DOCUMENT_PRIORITY }), true);
    await eventually(() => model.asked.includes(LONG_DOCUMENT), "the model never got the long document");

    // Queued after it, while it holds the model.
    assert.equal(await enqueueMonthExtraction(new BullmqExtractionJobQueue(), COMPANY, MONTH), 3);
    await eventually(
      () => reads.outcomeOf(ISDOC).length === 1 && reads.outcomeOf(RECEIPT).length === 1,
      "the receipt and the ISDOC invoice waited behind the model",
    );
    assert.equal(reads.outcomeOf(LONG_DOCUMENT).length, 0, "the long document is still with the model");

    const snapshot = await loadQueueSnapshot();
    assert.deepEqual(snapshot.concurrency, { read: 3, model: 1 });
    const busy = snapshot.running.find((job) => job.driveFileId === LONG_DOCUMENT);
    assert.equal(busy?.lane, "model");
    assert.match(busy?.stageLabel ?? "", /^Model · /);

    model.release();
    await eventually(() => reads.outcomeOf(LONG_DOCUMENT).length === 1, "the long document never finished");
    await eventually(() => reads.outcomeOf(SCANNED).length === 1, "the scanned document never finished");

    // Each document is recorded once, when it is finished, and read once by the model.
    assert.deepEqual(reads.reads.map((read) => read.outcome), reads.reads.map(() => "complete"));
    assert.equal(model.asked.filter((id) => id === LONG_DOCUMENT).length, 1);
    const recorded = (await redis().lrange(redisKey("extraction", "recent"), 0, -1))
      .map((raw) => JSON.parse(raw) as { driveFileId: string });
    assert.equal(recorded.filter((row) => row.driveFileId === LONG_DOCUMENT).length, 1);
    assert.equal(recorded.filter((row) => row.driveFileId === RECEIPT).length, 1);
  } finally {
    model.release();
    await lanes.stop();
    reads.stop();
  }
});

test("OCR of one document runs while the model reads another", { skip }, async () => {
  const model = new HeldModel(LONG_DOCUMENT);
  const ocr = new FakeOcr({ boxes: OCR_BOXES });
  const reads = recordReads();
  const lanes = await startLanes({ extractor: model, ocr });
  try {
    await new BullmqExtractionJobQueue().add(longDocumentJob(), { priority: DOCUMENT_PRIORITY });
    await eventually(() => model.asked.includes(LONG_DOCUMENT), "the model never got the long document");

    await enqueueMonthExtraction(new BullmqExtractionJobQueue(), COMPANY, MONTH);
    // The scanned document is read by OCR while the model is still busy.
    await eventually(() => ocr.calls.length > 0, "OCR waited for the model");
    assert.equal(reads.outcomeOf(LONG_DOCUMENT).length, 0);

    model.release();
    await eventually(() => reads.outcomeOf(SCANNED).length === 1, "the scanned document never finished");
    assert.equal(reads.outcomeOf(SCANNED)[0]!.outcome, "complete");
  } finally {
    model.release();
    await lanes.stop();
    reads.stop();
  }
});

test("a document queued twice, from either lane, is read once", { skip }, async () => {
  const model = new HeldModel(LONG_DOCUMENT);
  const reads = recordReads();
  const lanes = await startLanes({ extractor: model, ocr: new FakeOcr({ boxes: OCR_BOXES }) });
  try {
    const queue = new BullmqExtractionJobQueue();
    assert.equal(await queue.add(longDocumentJob(), { priority: DOCUMENT_PRIORITY }), true);
    // Queued again while being read: nothing new.
    assert.equal(await queue.add(longDocumentJob(), { priority: DOCUMENT_PRIORITY }), false);
    await eventually(() => model.asked.includes(LONG_DOCUMENT), "the model never got the long document");

    // Queued again from the reading lane while the model lane holds it.
    assert.equal(await queue.add(longDocumentJob(), { priority: DOCUMENT_PRIORITY }), false);
    assert.equal(await enqueueMonthExtraction(queue, COMPANY, MONTH), 3);

    model.release();
    await eventually(() => reads.outcomeOf(LONG_DOCUMENT).length === 1, "the long document never finished");
    assert.equal(model.asked.filter((id) => id === LONG_DOCUMENT).length, 1);
    // A finished document can be queued again: a later page render, a sweep.
    await eventually(() => reads.outcomeOf(SCANNED).length === 1, "the scanned document never finished");
  } finally {
    model.release();
    await lanes.stop();
    reads.stop();
  }
});

test("a model outage waits in the model lane while the reading lane goes on, and the documents are tried again once the model is back", { skip }, async () => {
  const model = new HeldModel(LONG_DOCUMENT);
  model.down = true;
  const reads = recordReads();
  const lanes = await startLanes({ extractor: model, ocr: new FakeOcr({ boxes: OCR_BOXES }) });
  try {
    await enqueueMonthExtraction(new BullmqExtractionJobQueue(), COMPANY, MONTH);

    // The receipt and the ISDOC invoice need no model: they finish meanwhile.
    await eventually(
      () => reads.outcomeOf(ISDOC).length === 1 && reads.outcomeOf(RECEIPT).length === 1,
      "the reading lane stopped with the model",
    );
    const waiting = (driveFileId: string) => async () =>
      (await loadQueueSnapshot()).delayed.some(
        (job) => job.driveFileId === driveFileId && job.lane === "model" && /EXTRACTOR_URL/.test(job.waitingReason ?? ""),
      );
    await eventually(waiting(LONG_DOCUMENT), "the long document does not wait for the model");
    await eventually(waiting(SCANNED), "the scanned document does not wait for the model");
    assert.equal(reads.outcomeOf(LONG_DOCUMENT).length, 0);

    // The model is back, and holds nothing: the documents are read at once.
    model.down = false;
    model.release();
    await extractionModelQueue().promoteJobs();
    await eventually(() => reads.outcomeOf(LONG_DOCUMENT).length === 1, "the long document was not tried again");
    await eventually(() => reads.outcomeOf(SCANNED).length === 1, "the scanned document was not tried again");
    assert.equal(reads.outcomeOf(LONG_DOCUMENT)[0]!.outcome, "complete");
  } finally {
    model.release();
    await lanes.stop();
    reads.stop();
  }
});

test("an OCR outage waits in the reading lane while the model lane and the other documents go on", { skip }, async () => {
  const model = new HeldModel("none");
  const ocr = new SwitchableOcr();
  const reads = recordReads();
  const lanes = await startLanes({ extractor: model, ocr });
  try {
    await enqueueMonthExtraction(new BullmqExtractionJobQueue(), COMPANY, MONTH);

    await eventually(
      () =>
        reads.outcomeOf(ISDOC).length === 1 &&
        reads.outcomeOf(RECEIPT).length === 1 &&
        reads.outcomeOf(LONG_DOCUMENT).length === 1,
      "the reading lane stopped with OCR, or the model lane did not read",
    );
    await eventually(
      async () =>
        (await loadQueueSnapshot()).delayed.some(
          (job) => job.driveFileId === SCANNED && job.lane === "read" && /OCR/.test(job.waitingReason ?? ""),
        ),
      "the scanned document does not wait for OCR in the reading lane",
    );
    assert.equal(reads.outcomeOf(SCANNED).length, 0);

    ocr.down = false;
    await extractionQueue().promoteJobs();
    await eventually(() => reads.outcomeOf(SCANNED).length === 1, "the scanned document was not tried again");
    assert.equal(reads.outcomeOf(SCANNED)[0]!.outcome, "complete");
  } finally {
    await lanes.stop();
    reads.stop();
  }
});
