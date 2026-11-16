import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  BullmqSubjectVerificationQueue,
  clientSubjectJobId,
  closeQueues,
  subjectQueue,
} from "../../../src/adapters/job-queue/bullmq-queues.ts";
import { saveCompanyProfileForUser } from "../../../src/lib/company-profile/service.ts";
import { getSubject, getSubjectLinkedTo } from "../../../src/adapters/store/subjects.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies } from "../../../src/lib/db/schema.ts";
import { closeRedis, redis, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";
import { startSubjectWorker } from "../../../src/lib/worker/subject-worker.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * A client's subject checked through the queue, as the replicas share it (0006/03):
 * `npm run test:redis` (TEST_REDIS_URL, e.g. the compose one). Skipped otherwise.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

const START = "2026-11-16T09:00:00.000Z";

before(async () => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-client-subject-${process.pid}`;
});

after(async () => {
  if (!url) {
    return;
  }
  await subjectQueue().obliterate({ force: true });
  const keys = await redis().keys(`${redisKeyPrefix()}:*`);
  if (keys.length > 0) {
    await redis().del(...keys);
  }
  await closeQueues();
  await closeRedis();
});

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the subject worker");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("a client's subject queued twice, as two replicas would, is one job", { skip }, async () => {
  const queue = new BullmqSubjectVerificationQueue();
  assert.equal(await queue.addClientSubject({ subjectId: 4242, enqueuedAt: START }), true);
  assert.equal(await queue.addClientSubject({ subjectId: 4242, enqueuedAt: START }), false);
  assert.ok(await subjectQueue().getJob(clientSubjectJobId(4242)));
  await subjectQueue().obliterate({ force: true });
});

test("a profile save queues the client's subject, and the subject worker checks it against the register", { skip }, async () => {
  await freshTestDb();
  await getDb().insert(companies).values({ id: 1, driveFolderId: "redis-alfa", name: "Doklady Beta s.r.o.", active: true });

  // The fake register (the e2e fixture the worker reads) holds this IČO under these values.
  const saved = await saveCompanyProfileForUser(
    1,
    {
      country: "SK",
      legalName: "Beta s.r.o.",
      address: "Bratislava, Pribinova 25",
      ico: "31333532",
      dic: "2020311335",
      icDph: "",
      registerSource: "",
      typedFields: ["legalName", "address", "dic"],
    },
    START,
  );
  assert.equal(saved.ok, true);
  const subject = await getSubjectLinkedTo(1);
  assert.ok(subject);
  assert.ok(await subjectQueue().getJob(clientSubjectJobId(subject.id)), "the save queued the subject");

  const { worker } = startSubjectWorker({ ...process.env, COMPANY_REGISTER: "fake", NODE_ENV: "test" });
  try {
    await waitFor(async () => Boolean((await getSubject(subject.id))?.verifiedAt));
    const checked = await getSubject(subject.id);
    assert.equal(checked?.registerStatus, "active");
    assert.equal(checked?.sources.legalName, "register", "her typed name the register holds is confirmed");
    assert.deepEqual(checked?.manualFields, []);
    assert.equal(await subjectQueue().getJob(clientSubjectJobId(subject.id)), undefined, "the finished job is removed");
  } finally {
    await worker.close();
  }
});
