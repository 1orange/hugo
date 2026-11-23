import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryExtractionJobQueue } from "../../../src/adapters/job-queue/memory-extraction-queue.ts";
import {
  BACKLOG_DOCUMENT_PRIORITY,
  BACKLOG_RECEIPT_PRIORITY,
  RECENT_DOCUMENT_PRIORITY,
  RAISED_DOCUMENT_PRIORITY,
  RAISED_RECEIPT_PRIORITY,
  RECENT_RECEIPT_PRIORITY,
  priorityFor,
  type ExtractionJobData,
  type ModelJobData,
} from "../../../src/adapters/job-queue/port.ts";
import { raiseMonthForReading } from "../../../src/lib/extraction-queue/raise-month.ts";

const COMPANY = 1;
const OPENED = "2026_01";
const OTHER = "2026_02";

test("a raised month sits ahead of every other tier, receipts ahead of documents in each", () => {
  const order = [
    priorityFor("receipt", "raised"),
    priorityFor("document", "raised"),
    priorityFor("receipt", "recent"),
    priorityFor("document", "recent"),
    priorityFor("receipt", "backlog"),
    priorityFor("document", "backlog"),
  ];
  assert.deepEqual(order, [
    RAISED_RECEIPT_PRIORITY,
    RAISED_DOCUMENT_PRIORITY,
    RECENT_RECEIPT_PRIORITY,
    RECENT_DOCUMENT_PRIORITY,
    BACKLOG_RECEIPT_PRIORITY,
    BACKLOG_DOCUMENT_PRIORITY,
  ]);
  // BullMQ takes the lowest number first and accepts 1 at the lowest.
  assert.ok(order.every((priority) => Number.isInteger(priority) && priority >= 1));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
});

test("a job queued without a tier waits as recent, the level it had before tiers", () => {
  assert.equal(priorityFor("receipt"), RECENT_RECEIPT_PRIORITY);
  assert.equal(priorityFor("document"), RECENT_DOCUMENT_PRIORITY);
});

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
    enqueuedAt: "2026-01-12T10:00:00.000Z",
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
    enqueuedAt: "2026-01-12T10:00:00.000Z",
  };
}

test("opening a month moves its waiting documents in both lanes, receipts still first, and leaves other months alone", async () => {
  const queue = new MemoryExtractionJobQueue();
  await queue.add(readJob("opened-doc", OPENED, "document"), { priority: RECENT_DOCUMENT_PRIORITY });
  await queue.add(readJob("other-doc", OTHER, "document"), { priority: RECENT_DOCUMENT_PRIORITY });
  await queue.add(readJob("opened-receipt", OPENED, "receipt"), { priority: RECENT_RECEIPT_PRIORITY });
  await queue.handOff(modelJob("opened-model", OPENED, "document"));
  await queue.handOff(modelJob("other-model", OTHER, "document"));

  assert.equal(await queue.raiseMonth(COMPANY, OPENED), 3);

  assert.equal(queue.jobs.get("opened-doc")!.priority, RAISED_DOCUMENT_PRIORITY);
  assert.equal(queue.jobs.get("opened-receipt")!.priority, RAISED_RECEIPT_PRIORITY);
  assert.equal(queue.modelJobs.get("opened-model")!.priority, RAISED_DOCUMENT_PRIORITY);
  assert.equal(queue.jobs.get("other-doc")!.priority, RECENT_DOCUMENT_PRIORITY);
  assert.equal(queue.modelJobs.get("other-model")!.priority, RECENT_DOCUMENT_PRIORITY);
});

test("opening the same month again moves nothing", async () => {
  const queue = new MemoryExtractionJobQueue();
  await queue.add(readJob("opened-doc", OPENED, "document"), { priority: RECENT_DOCUMENT_PRIORITY });
  assert.equal(await queue.raiseMonth(COMPANY, OPENED), 1);
  assert.equal(await queue.raiseMonth(COMPANY, OPENED), 0);
  assert.equal(queue.jobs.get("opened-doc")!.priority, RAISED_DOCUMENT_PRIORITY);
});

test("a document of an opened month handed to the model lane later keeps the raise; another month's does not", async () => {
  const queue = new MemoryExtractionJobQueue();
  await queue.raiseMonth(COMPANY, OPENED);
  assert.equal(await queue.handOff(modelJob("later-doc", OPENED, "document")), true);
  assert.equal(await queue.handOff(modelJob("later-receipt", OPENED, "receipt")), true);
  assert.equal(await queue.handOff(modelJob("other-doc", OTHER, "document")), true);
  assert.equal(queue.modelJobs.get("later-doc")!.priority, RAISED_DOCUMENT_PRIORITY);
  assert.equal(queue.modelJobs.get("later-receipt")!.priority, RAISED_RECEIPT_PRIORITY);
  assert.equal(queue.modelJobs.get("other-doc")!.priority, RECENT_DOCUMENT_PRIORITY);
});

test("the background raise resolves when the queue refuses, and when it does not answer in time", async () => {
  const refusing = {
    async raiseMonth(): Promise<number> {
      throw new Error("ECONNREFUSED 127.0.0.1:6379");
    },
  } as unknown as MemoryExtractionJobQueue;
  await assert.doesNotReject(raiseMonthForReading(COMPANY, OPENED, refusing));

  const silent = {
    raiseMonth: () => new Promise<number>(() => undefined),
  } as unknown as MemoryExtractionJobQueue;
  await assert.doesNotReject(raiseMonthForReading(COMPANY, OPENED, silent, 20));
});
