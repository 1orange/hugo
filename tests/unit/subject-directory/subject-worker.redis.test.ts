import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { closeQueues, subjectQueue } from "../../../src/adapters/job-queue/bullmq-queues.ts";
import { closeRedis, redis, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";
import { SubjectLookupDeferred } from "../../../src/lib/subject-directory/service.ts";
import { startSubjectWorker } from "../../../src/lib/worker/subject-worker.ts";

/**
 * A register lookup refused by the rate limit, on a real queue: `npm run test:redis`
 * (TEST_REDIS_URL). Skipped otherwise.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

before(() => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-subject-${process.pid}`;
});

after(async () => {
  if (!url) {
    return;
  }
  const keys = await redis().keys(`${redisKeyPrefix()}:*`);
  if (keys.length > 0) {
    await redis().del(...keys);
  }
  await closeQueues();
  await closeRedis();
});

test("a refused lookup pauses the queue and is tried again, without failing or spending an attempt", { skip }, async () => {
  const queue = subjectQueue();
  await queue.obliterate({ force: true });
  let calls = 0;
  const { worker } = startSubjectWorker(process.env, {
    async process() {
      calls += 1;
      if (calls === 1) {
        throw new SubjectLookupDeferred(1_200);
      }
    },
  });
  const failed: string[] = [];
  worker.on("failed", (job) => failed.push(job?.id ?? "?"));
  const completed = new Promise<{ attemptsMade: number }>((resolve) =>
    worker.on("completed", (job) => resolve({ attemptsMade: job.attemptsMade })),
  );

  const started = Date.now();
  // One attempt only: a refusal that counted as a failure would drop the check.
  const data = { documentId: "doc-1", companyId: 1, monthKey: "2026_10", driveFileId: "doc-1", enqueuedAt: new Date().toISOString() };
  await queue.add("verify", data, { jobId: "subject-doc-1", attempts: 1, removeOnComplete: true, removeOnFail: true });
  const done = await completed;

  assert.equal(calls, 2, "tried again after the pause");
  assert.ok(Date.now() - started >= 1_000, "paused until the limiter had a slot");
  assert.deepEqual(failed, [], "a refusal is not a failure");
  assert.ok(done.attemptsMade <= 1, "the refusal spent no attempt");
  await worker.close();
});
