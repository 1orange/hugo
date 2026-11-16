import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Redis } from "ioredis";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import {
  BullmqSubjectVerificationQueue,
  closeQueues,
  subjectJobId,
  subjectQueue,
} from "../../../src/adapters/job-queue/bullmq-queues.ts";
import type { SubjectVerificationJobData } from "../../../src/adapters/job-queue/port.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { ensureDocumentsForMonth, getDocument, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, files, months, subjects } from "../../../src/lib/db/schema.ts";
import { subscribeAppEvents, type AppEvent } from "../../../src/lib/events/bus.ts";
import { closeRedis, redis, redisKey, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";
import { RedisLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import { verifyCounterparty, type DirectoryDeps } from "../../../src/lib/subject-directory/service.ts";
import { startSubjectWorker } from "../../../src/lib/worker/subject-worker.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { parsePartyIntegrityRecord } from "../../../src/modules/subject-integrity.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * The subject directory as the replicas share it, against a real Redis (ADR 0022):
 * `npm run test:redis` (TEST_REDIS_URL, e.g. the compose one). Skipped otherwise.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

/** Connections a test opened as further replicas, closed at the end. */
const replicas: Redis[] = [];

function replica(): Redis {
  const client = new Redis(url!, { maxRetriesPerRequest: null });
  replicas.push(client);
  return client;
}

before(async () => {
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
  await subjectQueue().obliterate({ force: true });
  const keys = await redis().keys(`${redisKeyPrefix()}:*`);
  if (keys.length > 0) {
    await redis().del(...keys);
  }
  await Promise.all(replicas.map((client) => client.quit()));
  await closeQueues();
  await closeRedis();
});

test("the lookup lock is held by one replica at a time, and released only by its holder", { skip }, async () => {
  const first = new RedisLookupLock(replica());
  const second = new RedisLookupLock(replica());

  const token = await first.tryAcquire("SK:31333532", 10_000);
  assert.ok(token, "the free key is taken");
  assert.equal(await second.tryAcquire("SK:31333532", 10_000), null, "the other replica is refused");
  assert.ok(await second.tryAcquire("CZ:31333532", 10_000), "another subject's key is its own");

  await second.release("SK:31333532", "not-the-token");
  assert.equal(await redis().exists(redisKey("subject-lookup", "SK:31333532")), 1, "a stranger cannot release it");

  const waited = second.waitUntilFree("SK:31333532", 5_000).then(() => Date.now());
  const releasedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await first.release("SK:31333532", token);
  assert.ok((await waited) >= releasedAt + 300, "the waiter waits for the release");
  assert.ok(await second.tryAcquire("SK:31333532", 10_000), "once released, the key is free again");
});

test("a lock whose holder died expires, so the subject is not locked for ever", { skip }, async () => {
  const lock = new RedisLookupLock(replica());
  assert.ok(await lock.tryAcquire("SK:35757442", 200));
  assert.equal(await lock.tryAcquire("SK:35757442", 200), null);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(await lock.tryAcquire("SK:35757442", 200), "taken again after the TTL");
});

test("two replicas checking one unknown subject at once ask the register once", { skip }, async () => {
  await freshTestDb();
  // One register each, slow enough for the two checks to overlap.
  const registers = [0, 1].map(
    () =>
      new FakeCompanyRegister({
        delayMs: 400,
        lookups: [{ country: "SK", ico: "35757442", legalName: "Beta Group s.r.o.", address: "Košice", dic: "2020357574", status: "active" }],
      }),
  );
  const now = "2026-03-01T00:00:00.000Z";
  const depsOf = (register: FakeCompanyRegister): DirectoryDeps => ({
    register,
    vat: new FakeVatRegister(),
    lock: new RedisLookupLock(replica()),
    limiter: createLookupRateLimiter({ perMinute: 1000 }),
    refreshDays: 30,
    now: () => now,
    waitMs: 5_000,
  });
  const party = { name: "Beta Group s.r.o.", ico: "35757442", dic: "2020357574", icDph: "" };

  const [one, two] = await Promise.all([
    verifyCounterparty(party, depsOf(registers[0]!), { documentId: "doc-a" }),
    verifyCounterparty(party, depsOf(registers[1]!), { documentId: "doc-b" }),
  ]);

  assert.equal(registers[0]!.lookupCalls.length + registers[1]!.lookupCalls.length, 1);
  assert.equal(one.subjectId, two.subjectId);
  for (const check of [one, two]) {
    assert.equal(check.register && "legalName" in check.register ? check.register.legalName : null, "Beta Group s.r.o.");
  }
  assert.equal((await getDb().select().from(subjects)).length, 1);
  assert.equal(await redis().exists(redisKey("subject-lookup", "SK:35757442")), 0, "the lock is released");
});

function job(documentId: string): SubjectVerificationJobData {
  return {
    documentId,
    companyId: 1,
    monthKey: "2026_02",
    driveFileId: documentId,
    enqueuedAt: new Date().toISOString(),
  };
}

test("a document queued twice, as two replicas would, is one party check", { skip }, async () => {
  const queue = new BullmqSubjectVerificationQueue();
  // A document id may hold "#" (one of several receipts in a scan): still one job.
  assert.equal(await queue.add(job("scan-1#2")), true);
  assert.equal(await queue.add(job("scan-1#2")), false);
  assert.equal(await queue.add(job("scan-1#3")), true);
  const counts = await subjectQueue().getJobCounts("waiting", "prioritized", "delayed");
  assert.equal(counts.waiting + counts.prioritized + counts.delayed, 2);
  assert.ok(await subjectQueue().getJob(subjectJobId("scan-1#2")));
  await subjectQueue().obliterate({ force: true });
});

const INVOICE = "redis-invoice";
const START = "2026-02-01T00:00:00.000Z";
const CLIENT = { name: "Delta s.r.o.", ico: "31333532", dic: "2020311337", icDph: "SK2020311337" };
// A supplier the fake register (the e2e fixture the worker's register reads) holds.
const SUPPLIER = { name: "Beta Group s.r.o.", ico: "35757442", dic: "2020357574", icDph: "" };

async function seedInvoice(): Promise<void> {
  await freshTestDb();
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: "redis-company", name: "Delta s.r.o.", active: true });
  await db.insert(months).values({ id: 1, companyId: 1, monthKey: "2026_02", driveFolderId: "redis-month", closedAt: null, openedAt: START });
  await db.insert(files).values({
    driveFileId: INVOICE,
    companyId: 1,
    monthKey: "2026_02",
    folderSlot: "02 Prijaté faktúry",
    parentId: "redis-slot-02",
    name: "invoice.pdf",
    mimeType: "application/pdf",
    driveCreatedTime: START,
    firstSeenAt: START,
    lastSeenAt: START,
    deleted: false,
  });
  await ensureDocumentsForMonth(1, "2026_02", START);
  const extraction: ModelExtractedPayload = {
    kind: "extracted",
    source: "model",
    parties: [SUPPLIER, CLIENT],
    documentNumber: "FA-1",
    variableSymbol: "1",
    issueDate: "2026-02-03",
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 12000,
    amountLiteral: "120.00",
    vatRecap: [],
    docTypeHint: "invoice",
  };
  await writeExtractedPayload(INVOICE, extraction, "complete", null);
  await saveCompanyProfile(1, {
    country: "SK",
    legalName: CLIENT.name,
    address: "Bratislava",
    ico: CLIENT.ico,
    dic: CLIENT.dic,
    icDph: CLIENT.icDph,
    registerSource: "fake",
    savedAt: START,
  });
}

test("the subject worker checks a queued document's parties, and every replica hears it", { skip }, async () => {
  await seedInvoice();
  const checked = new Promise<AppEvent>((resolve) => {
    const unsubscribe = subscribeAppEvents((event) => {
      if (event.type === "document-checked") {
        unsubscribe();
        resolve(event);
      }
    });
  });
  // The subscription is ready before the worker can finish.
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(await new BullmqSubjectVerificationQueue().add(job(INVOICE)), true);
  const { worker } = startSubjectWorker({ ...process.env, COMPANY_REGISTER: "fake", NODE_ENV: "test" });
  try {
    assert.deepEqual(await checked, {
      type: "document-checked",
      companyId: 1,
      monthKey: "2026_02",
      driveFileId: INVOICE,
    });
    const record = parsePartyIntegrityRecord((await getDocument(INVOICE))!.partyIntegrityJson);
    assert.ok(record, "the verdicts are stored on the document");
    assert.equal(record.supplier.verdict, "verified");
    const [subject] = await getDb().select().from(subjects);
    assert.equal(subject?.legalName, "Beta Group s.r.o.");
    assert.equal(await subjectQueue().getJob(subjectJobId(INVOICE)), undefined, "the finished job is removed");
  } finally {
    await worker.close();
  }
});
