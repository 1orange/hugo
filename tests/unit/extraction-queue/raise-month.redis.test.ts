import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "bullmq";
import {
  BullmqExtractionJobQueue,
  EXTRACTION_QUEUE,
  closeQueues,
  extractionJobId,
  extractionModelQueue,
  extractionQueue,
  sweepQueue,
} from "../../../src/adapters/job-queue/bullmq-queues.ts";
import {
  DOCUMENT_PRIORITY,
  RAISED_DOCUMENT_PRIORITY,
  RAISED_RECEIPT_PRIORITY,
  RECEIPT_PRIORITY,
  type ExtractionJobData,
  type ModelJobData,
} from "../../../src/adapters/job-queue/port.ts";
import { loadQueueSnapshot } from "../../../src/lib/extraction-queue/snapshot.ts";
import { raiseMonthForReading } from "../../../src/lib/extraction-queue/raise-month.ts";
import { closeRedis, openRedisConnection, redis, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";

/**
 * Opening a month, as the replicas share the queues: `npm run test:redis`
 * (TEST_REDIS_URL, e.g. the compose one). Skipped otherwise.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

const COMPANY = 1;
const OPENED = "2026_02";
const OTHER = "2026_01";

before(async () => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-raise-${process.pid}`;
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

/** Empties both lanes and forgets every opened month, so each test starts alike. */
async function clearLanes(): Promise<void> {
  await extractionQueue().obliterate({ force: true });
  await extractionModelQueue().obliterate({ force: true });
  await sweepQueue().obliterate({ force: true });
  const marks = await redis().keys(`${redisKeyPrefix()}:extraction:raised:*`);
  if (marks.length > 0) {
    await redis().del(...marks);
  }
}

function readJob(driveFileId: string, monthKey: string, kind: "receipt" | "document"): ExtractionJobData {
  return {
    kind,
    companyId: COMPANY,
    companyName: "Delta s.r.o.",
    monthKey,
    driveFileId,
    fileName: `${driveFileId}.pdf`,
    folderSlot: "02 Prijaté faktúry",
    mimeType: "application/pdf",
    enqueuedAt: "2026-02-12T10:00:00.000Z",
  };
}

function modelJob(driveFileId: string, monthKey: string, kind: "receipt" | "document"): ModelJobData {
  return {
    kind,
    companyId: COMPANY,
    companyName: "Delta s.r.o.",
    monthKey,
    driveFileId,
    fileName: `${driveFileId}.pdf`,
    folderSlot: "02 Prijaté faktúry",
    source: "model",
    lines: ["Faktúra"],
    readStartedAt: 0,
    enqueuedAt: "2026-02-12T10:00:00.000Z",
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

test("raising one month makes its documents the next ones a worker takes, receipts still first within it", { skip }, async () => {
  await clearLanes();
  const queue = new BullmqExtractionJobQueue();
  // The other month is queued first, so without the raise it would go first.
  assert.equal(await queue.add(readJob("old-doc-1", OTHER, "document"), { priority: DOCUMENT_PRIORITY }), true);
  assert.equal(await queue.add(readJob("old-doc-2", OTHER, "document"), { priority: DOCUMENT_PRIORITY }), true);
  assert.equal(await queue.add(readJob("old-receipt", OTHER, "receipt"), { priority: RECEIPT_PRIORITY }), true);
  // The opened month's receipt is queued last, and still goes first within it.
  assert.equal(await queue.add(readJob("new-doc-1", OPENED, "document"), { priority: DOCUMENT_PRIORITY }), true);
  assert.equal(await queue.add(readJob("new-doc-2", OPENED, "document"), { priority: DOCUMENT_PRIORITY }), true);
  assert.equal(await queue.add(readJob("new-receipt", OPENED, "receipt"), { priority: RECEIPT_PRIORITY }), true);

  assert.equal(await queue.raiseMonth(COMPANY, OPENED), 3);

  // The listing the queue screen shows is in the order a worker takes them.
  const listed = (await loadQueueSnapshot()).waiting.filter((job) => job.lane === "read").map((job) => job.driveFileId);
  assert.deepEqual(listed, ["new-receipt", "new-doc-1", "new-doc-2", "old-receipt", "old-doc-1", "old-doc-2"]);

  const taken: string[] = [];
  const worker = new Worker<ExtractionJobData>(
    EXTRACTION_QUEUE,
    async (job) => {
      taken.push(job.data.driveFileId);
    },
    { connection: openRedisConnection(), prefix: redisKeyPrefix(), concurrency: 1 },
  );
  try {
    await eventually(() => taken.length === 6, "the worker did not take all six documents");
    assert.deepEqual(taken, ["new-receipt", "new-doc-1", "new-doc-2", "old-receipt", "old-doc-1", "old-doc-2"]);
  } finally {
    await worker.close();
  }
});

test("a document of the opened month waiting in the model lane, or delayed for it, is raised; a document handed over later keeps the raise", { skip }, async () => {
  await clearLanes();
  const queue = new BullmqExtractionJobQueue();
  assert.equal(await queue.handOff(modelJob("waiting-model", OPENED, "document")), true);
  assert.equal(await queue.handOff(modelJob("other-model", OTHER, "document")), true);
  // Delayed: waiting for the model to come back. It takes the raise when it is promoted.
  await extractionModelQueue().add("model", modelJob("delayed-model", OPENED, "document"), {
    jobId: extractionJobId("delayed-model"),
    priority: DOCUMENT_PRIORITY,
    delay: 60 * 60 * 1000,
  });

  assert.equal(await queue.raiseMonth(COMPANY, OPENED), 2);
  assert.equal((await extractionModelQueue().getJob(extractionJobId("waiting-model")))?.priority, RAISED_DOCUMENT_PRIORITY);
  assert.equal((await extractionModelQueue().getJob(extractionJobId("delayed-model")))?.priority, RAISED_DOCUMENT_PRIORITY);
  assert.equal((await extractionModelQueue().getJob(extractionJobId("other-model")))?.priority, DOCUMENT_PRIORITY);

  // Handed over after the month was opened, from the reading lane.
  assert.equal(await queue.handOff(modelJob("later-model", OPENED, "receipt")), true);
  assert.equal(await queue.handOff(modelJob("later-other", OTHER, "document")), true);
  assert.equal((await extractionModelQueue().getJob(extractionJobId("later-model")))?.priority, RAISED_RECEIPT_PRIORITY);
  assert.equal((await extractionModelQueue().getJob(extractionJobId("later-other")))?.priority, DOCUMENT_PRIORITY);
});

test("opening the same month again moves nothing, and a month with nothing waiting is a no-op", { skip }, async () => {
  await clearLanes();
  const queue = new BullmqExtractionJobQueue();
  await queue.add(readJob("opened-doc", OPENED, "document"), { priority: DOCUMENT_PRIORITY });

  assert.equal(await queue.raiseMonth(COMPANY, OPENED), 1);
  assert.equal(await queue.raiseMonth(COMPANY, OPENED), 0);
  assert.equal(await queue.raiseMonth(COMPANY, "2026_03"), 0);
  assert.equal((await extractionQueue().getJob(extractionJobId("opened-doc")))?.priority, RAISED_DOCUMENT_PRIORITY);
});

test("with Redis down, the background raise resolves without throwing", { skip }, async () => {
  await clearLanes();
  const configured = process.env.REDIS_URL;
  // Drop the connections, then point at a port nothing listens on: commands
  // never answer, so only the raise's own timeout ends it.
  await closeQueues();
  await closeRedis();
  try {
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    await assert.doesNotReject(raiseMonthForReading(COMPANY, OPENED, new BullmqExtractionJobQueue(), 300));

    // Not configured at all: the same, at once.
    delete process.env.REDIS_URL;
    await closeQueues();
    await closeRedis();
    await assert.doesNotReject(raiseMonthForReading(COMPANY, OPENED, new BullmqExtractionJobQueue(), 300));
  } finally {
    process.env.REDIS_URL = configured;
    await closeQueues();
    await closeRedis();
  }
});
