import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  BullmqExtractionJobQueue,
  closeQueues,
  extractionModelQueue,
  extractionQueue,
  sweepQueue,
} from "../../../src/adapters/job-queue/bullmq-queues.ts";
import { priorityFor, type ExtractionJobData } from "../../../src/adapters/job-queue/port.ts";
import { recordFinishedJob } from "../../../src/lib/extraction-queue/snapshot.ts";
import { loadExtractionQueueView } from "../../../src/lib/extraction-queue/view.ts";
import type { FinishedJobView } from "../../../src/lib/extraction-queue/types.ts";
import { closeRedis, redis, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * The queue page and the event stream's queue, built for one person (ADR 0023):
 * the waiting months, the jobs and the estimate name only her companies. Real
 * BullMQ queues: `npm run test:redis` (TEST_REDIS_URL). Skipped otherwise.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

const ALFA = { id: 1, name: "Alfa s.r.o." };
const BETA = { id: 2, name: "Beta a.s." };

before(async () => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-queue-visibility-${process.pid}`;
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

async function clearLanes(): Promise<void> {
  await extractionQueue().obliterate({ force: true });
  await extractionModelQueue().obliterate({ force: true });
}

function readJob(company: { id: number; name: string }, driveFileId: string): ExtractionJobData {
  return {
    kind: "document",
    companyId: company.id,
    companyName: company.name,
    monthKey: "2026_10",
    driveFileId,
    fileName: `${driveFileId}.pdf`,
    folderSlot: "02 Prijaté faktúry",
    mimeType: "application/pdf",
    enqueuedAt: new Date().toISOString(),
  };
}

/** Five finished records with stages: the estimate needs them, whoever is asking. */
async function seedTimings(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    const record: FinishedJobView = {
      driveFileId: `timed-${index}`,
      kind: "document",
      companyId: BETA.id,
      companyName: BETA.name,
      monthKey: "2026_09",
      fileName: `timed-${index}.pdf`,
      finishedAt: new Date().toISOString(),
      durationMs: 4000,
      outcome: "complete",
      reason: null,
      stages: [{ stage: "download", durationMs: 1000 + index * 100 }, { stage: "prompt", durationMs: 2000 }],
    };
    await recordFinishedJob(record);
  }
}

test("each person's queue names only their companies: jobs, waiting months and the estimate", { skip }, async () => {
  await freshTestDb();
  await clearLanes();
  await seedTimings();
  const queue = new BullmqExtractionJobQueue();
  await queue.add(readJob(ALFA, "alfa-invoice"), { priority: priorityFor("document", "recent") });
  for (let index = 0; index < 40; index += 1) {
    await queue.add(readJob(BETA, `beta-invoice-${index}`), { priority: priorityFor("document", "backlog") });
  }

  const eva = await loadExtractionQueueView(new Set([ALFA.id]));
  const jana = await loadExtractionQueueView(new Set([BETA.id]));
  const nobody = await loadExtractionQueueView(new Set());

  assert.deepEqual(eva.waitingMonths.map((month) => month.companyId), [ALFA.id]);
  assert.deepEqual(jana.waitingMonths.map((month) => month.companyId), [BETA.id]);
  assert.deepEqual(nobody.waitingMonths, []);

  assert.deepEqual(eva.waiting.map((job) => job.driveFileId), ["alfa-invoice"]);
  assert.equal(jana.waiting.length, 40);
  assert.deepEqual(nobody.waiting, []);

  // Eva's estimate counts her one document; Jana's counts her forty. Same timing samples, so Jana's is longer.
  assert.equal(eva.estimate.kind, "known");
  assert.equal(jana.estimate.kind, "known");
  assert.ok(jana.estimate.kind === "known" && eva.estimate.kind === "known" && jana.estimate.ms > eva.estimate.ms * 10);
  assert.deepEqual(nobody.estimate, { kind: "empty" }, "nothing of hers is waiting, so nothing to estimate");
});

test("the queue sent to one person names no file or company of another", { skip }, async () => {
  await freshTestDb();
  await clearLanes();
  await seedTimings();
  const queue = new BullmqExtractionJobQueue();
  await queue.add(readJob(ALFA, "alfa-invoice"), { priority: priorityFor("document", "recent") });
  await queue.add(readJob(BETA, "beta-invoice"), { priority: priorityFor("document", "recent") });

  const forEva = JSON.stringify(await loadExtractionQueueView(new Set([ALFA.id])));
  const forJana = JSON.stringify(await loadExtractionQueueView(new Set([BETA.id])));

  assert.ok(forEva.includes("alfa-invoice"));
  assert.ok(!forEva.includes(BETA.name), "Beta's name is not in Eva's queue");
  assert.ok(!forEva.includes("beta-invoice"), "nor Beta's file name");
  assert.ok(!forJana.includes(ALFA.name), "Alfa's name is not in Jana's queue");
  assert.ok(!forJana.includes("alfa-invoice"), "nor Alfa's file name");
});
