import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "bullmq";
import {
  BullmqExtractionJobQueue,
  EXTRACTION_QUEUE,
  closeQueues,
  extractionModelQueue,
  extractionQueue,
  sweepQueue,
} from "../../../src/adapters/job-queue/bullmq-queues.ts";
import type { ExtractionJobData } from "../../../src/adapters/job-queue/port.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { listCompanies } from "../../../src/adapters/store/companies.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { queueReadingWindow } from "../../../src/lib/extraction-queue/reading-window.ts";
import { closeRedis, openRedisConnection, redis, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * The reading window against the shared queue: `npm run test:redis`
 * (TEST_REDIS_URL, database 11 only). Skipped otherwise.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

const INSTANT = new Date("2026-11-23T11:00:00.000Z");

before(async () => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-window-${process.pid}`;
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

function folder(id: string, name: string, parent: string | null) {
  return { id, name, parents: parent ? [parent] : [], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME };
}

function file(id: string, parent: string, mimeType = "application/pdf") {
  return { id, name: `${id}.pdf`, parents: [parent], createdTime: "2026-10-05T00:00:00.000Z", mimeType };
}

/** Delta and Echo with files in every tier: a raised August invoice, recent October and November files, an older backlog July invoice. */
function tree() {
  return [
    folder("parent", "Clients", null),
    folder("delta", "Delta s.r.o.", "parent"),
    folder("echo", "Echo s.r.o.", "parent"),
    folder("d07", "2026_07", "delta"),
    folder("d08", "2026_08", "delta"),
    folder("d10", "2026_10", "delta"),
    folder("d11", "2026_11", "delta"),
    folder("e10", "2026_10", "echo"),
    folder("d07-02", "02 Prijaté faktúry", "d07"),
    folder("d08-02", "02 Prijaté faktúry", "d08"),
    folder("d10-02", "02 Prijaté faktúry", "d10"),
    folder("d10-04", "04 Bločky", "d10"),
    folder("d11-02", "02 Prijaté faktúry", "d11"),
    folder("d11-04", "04 Bločky", "d11"),
    folder("e10-02", "02 Prijaté faktúry", "e10"),
    file("inv-07", "d07-02"),
    file("inv-08", "d08-02"),
    file("inv-10", "d10-02"),
    file("rec-10", "d10-04"),
    file("inv-11", "d11-02"),
    file("photo-11", "d11-04", "image/jpeg"),
    file("echo-10", "e10-02"),
  ];
}

async function clearQueues(): Promise<void> {
  await extractionQueue().obliterate({ force: true });
  await extractionModelQueue().obliterate({ force: true });
}

test("the reading window's jobs are taken raised first, then recent, then backlog, receipts first in each", { skip }, async () => {
  await clearQueues();
  await freshTestDb();
  await setDriveParentFolderId("parent");
  await runSweep(new FakeDriveClient(tree(), {}));
  const deltaId = (await listCompanies()).find((company) => company.name === "Delta s.r.o.")!.id;

  // August is the month an accountant has open: its invoice is raised over the recent tier.
  const added = await queueReadingWindow(new BullmqExtractionJobQueue(), {
    windowStart: "2026_01",
    raised: { companyId: deltaId, monthKey: "2026_08" },
    instant: INSTANT,
  });
  assert.equal(added, 7);

  const taken: string[] = [];
  const worker = new Worker<ExtractionJobData>(
    EXTRACTION_QUEUE,
    async (job) => {
      taken.push(job.data.driveFileId);
    },
    { connection: openRedisConnection(), prefix: redisKeyPrefix(), concurrency: 1 },
  );
  try {
    const deadline = Date.now() + 15_000;
    while (taken.length < added && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await worker.close();
  }

  assert.deepEqual(taken, [
    // raised: the opened month's invoice
    "inv-08",
    // recent receipts, in the order they were planned
    "rec-10",
    "photo-11",
    // recent documents: October (booking) before November (current)
    "inv-10",
    "echo-10",
    "inv-11",
    // backlog
    "inv-07",
  ]);
});
