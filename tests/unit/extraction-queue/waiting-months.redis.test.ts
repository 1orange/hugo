import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  BullmqExtractionJobQueue,
  closeQueues,
  extractionModelQueue,
  extractionQueue,
  sweepQueue,
} from "../../../src/adapters/job-queue/bullmq-queues.ts";
import { priorityFor, type ExtractionJobData, type ModelJobData } from "../../../src/adapters/job-queue/port.ts";
import { loadQueueSnapshot } from "../../../src/lib/extraction-queue/snapshot.ts";
import { closeRedis, redis, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";

/**
 * The waiting counts per company and month, over the whole queue, with the real
 * BullMQ queues: `npm run test:redis` (TEST_REDIS_URL, e.g. the compose one).
 * Skipped otherwise.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

before(async () => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-waiting-${process.pid}`;
});

after(async () => {
  if (!url) {
    return;
  }
  await extractionQueue().obliterate({ force: true });
  await extractionModelQueue().obliterate({ force: true });
  await sweepQueue().obliterate({ force: true });
  const keys = await redis().keys(`${redisKeyPrefix()}:*`);
  if (keys.length > 0) {
    await redis().del(...keys);
  }
  await closeQueues();
  await closeRedis();
});

/** Each test starts from an empty queue: the lanes are shared across the file. */
async function clearLanes(): Promise<void> {
  await extractionQueue().obliterate({ force: true });
  await extractionModelQueue().obliterate({ force: true });
}

function readJob(
  driveFileId: string,
  overrides: Partial<ExtractionJobData> = {},
): ExtractionJobData {
  return {
    kind: "document",
    companyId: 1,
    companyName: "Delta s.r.o.",
    monthKey: "2026_10",
    driveFileId,
    fileName: `${driveFileId}.pdf`,
    folderSlot: "02 Prijaté faktúry",
    mimeType: "application/pdf",
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  };
}

function modelJob(driveFileId: string, overrides: Partial<ModelJobData> = {}): ModelJobData {
  return {
    kind: "document",
    companyId: 2,
    companyName: "Beta a.s.",
    monthKey: "2026_09",
    driveFileId,
    fileName: `${driveFileId}.pdf`,
    folderSlot: "02 Prijaté faktúry",
    source: "model",
    lines: ["faktúra"],
    readStartedAt: Date.now(),
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** The months as the screen compares them: who, which month, the tier, and each lane's count. */
function summary(snapshot: Awaited<ReturnType<typeof loadQueueSnapshot>>) {
  return snapshot.waitingMonths.map((month) => ({
    companyId: month.companyId,
    monthKey: month.monthKey,
    tier: month.tier,
    reading: month.reading,
    model: month.model,
  }));
}

test("waiting documents are counted per company and month, past the rows the queue lists", { skip }, async () => {
  await clearLanes();
  const queue = new BullmqExtractionJobQueue();
  // 205 backlog documents of one month: more than the 200 rows of a waiting list.
  for (let index = 0; index < 205; index += 1) {
    await queue.add(readJob(`bulk-${index}`), { priority: priorityFor("document", "backlog") });
  }
  await queue.add(readJob("receipt-b", { kind: "receipt", companyId: 2, companyName: "Beta a.s.", monthKey: "2026_09" }), {
    priority: priorityFor("receipt", "recent"),
  });
  await queue.handOff(modelJob("handed-b"));

  const snapshot = await loadQueueSnapshot();
  assert.equal(snapshot.waiting.filter((job) => job.lane === "read").length, 200, "the list is still capped");
  assert.deepEqual(summary(snapshot), [
    { companyId: 2, monthKey: "2026_09", tier: "recent", reading: 1, model: 1 },
    { companyId: 1, monthKey: "2026_10", tier: "backlog", reading: 205, model: 0 },
  ]);
  assert.equal(snapshot.waitingMonths[1]!.companyName, "Delta s.r.o.");
});

test("opening a month moves its waiting documents ahead, and the snapshot says so", { skip }, async () => {
  await clearLanes();
  const queue = new BullmqExtractionJobQueue();
  await queue.add(readJob("raise-a"), { priority: priorityFor("document", "backlog") });
  await queue.add(readJob("raise-b", { kind: "receipt" }), { priority: priorityFor("receipt", "backlog") });
  await queue.handOff(
    modelJob("raise-handed", { companyId: 1, companyName: "Delta s.r.o.", monthKey: "2026_10", tier: "backlog" }),
  );
  await queue.add(readJob("other-month", { companyId: 2, companyName: "Beta a.s.", monthKey: "2026_09" }), {
    priority: priorityFor("document", "recent"),
  });

  assert.deepEqual(summary(await loadQueueSnapshot()), [
    { companyId: 2, monthKey: "2026_09", tier: "recent", reading: 1, model: 0 },
    { companyId: 1, monthKey: "2026_10", tier: "backlog", reading: 2, model: 1 },
  ]);

  assert.equal(await queue.raiseMonth(1, "2026_10"), 3);
  assert.deepEqual(summary(await loadQueueSnapshot()), [
    { companyId: 1, monthKey: "2026_10", tier: "raised", reading: 2, model: 1 },
    { companyId: 2, monthKey: "2026_09", tier: "recent", reading: 1, model: 0 },
  ]);
});
