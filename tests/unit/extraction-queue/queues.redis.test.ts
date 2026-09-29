import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { stubTextLinesForDriveFile } from "../../../src/adapters/extractor/stub-fixtures.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import {
  BullmqExtractionJobQueue,
  closeQueues,
  extractionQueue,
  sweepQueue,
} from "../../../src/adapters/job-queue/bullmq-queues.ts";
import { DOCUMENT_PRIORITY, type ExtractionJobData } from "../../../src/adapters/job-queue/port.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { requestDriveSync } from "../../../src/lib/drive-watch/drive-watch.ts";
import { subscribeAppEvents, type AppEvent } from "../../../src/lib/events/bus.ts";
import { enqueueMonthExtraction } from "../../../src/lib/extraction-queue/enqueue.ts";
import { loadQueueSnapshot } from "../../../src/lib/extraction-queue/snapshot.ts";
import { closeRedis, redis, redisKeyPrefix } from "../../../src/lib/redis/connection.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { startExtractionWorker } from "../../../src/lib/worker/extraction-worker.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * The queue as the replicas share it, against a real Redis:
 * `npm run test:redis` (TEST_REDIS_URL, e.g. the compose one). Skipped otherwise.
 */
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run against Redis (npm run test:redis)";

before(async () => {
  if (!url) {
    return;
  }
  process.env.REDIS_URL = url;
  process.env.HUGO_REDIS_PREFIX = `hugo-test-${process.pid}`;
});

after(async () => {
  if (!url) {
    return;
  }
  await extractionQueue().obliterate({ force: true });
  await sweepQueue().obliterate({ force: true });
  const keys = await redis().keys(`${redisKeyPrefix()}:*`);
  if (keys.length > 0) {
    await redis().del(...keys);
  }
  await closeQueues();
  await closeRedis();
});

function job(driveFileId: string): ExtractionJobData {
  return {
    kind: "document",
    companyId: 1,
    companyName: "Delta s.r.o.",
    monthKey: "2026_01",
    driveFileId,
    fileName: `${driveFileId}.pdf`,
    folderSlot: "02 Prijaté faktúry",
    mimeType: "application/pdf",
    enqueuedAt: new Date().toISOString(),
  };
}

test("a file queued twice, as two replicas would, is one job", { skip }, async () => {
  const queue = new BullmqExtractionJobQueue();
  assert.equal(await queue.add(job("dup-file"), { priority: DOCUMENT_PRIORITY }), true);
  assert.equal(await queue.add(job("dup-file"), { priority: DOCUMENT_PRIORITY }), false);
  const counts = await extractionQueue().getJobCounts("waiting", "prioritized");
  assert.equal(counts.waiting + counts.prioritized, 1);
  await extractionQueue().obliterate({ force: true });
});

test("a burst of Drive notifications is one sweep", { skip }, async () => {
  for (let file = 0; file < 12; file += 1) {
    await requestDriveSync();
  }
  assert.equal(await sweepQueue().getDelayedCount(), 1);
  await sweepQueue().obliterate({ force: true });
});

test("a worker reads a queued document, and every replica hears it", { skip }, async () => {
  await freshTestDb();
  const folder = (id: string, name: string, parent: string | null) => ({
    id,
    name,
    parents: parent ? [parent] : [],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  });
  const driveClient = new FakeDriveClient(
    [
      folder("parent", "Clients", null),
      folder("company", "Delta s.r.o.", "parent"),
      folder("month", "2026_01", "company"),
      folder("slot-02", "02 Prijaté faktúry", "month"),
      {
        id: "doc-invoice-a",
        name: "doc-invoice-a.pdf",
        parents: ["slot-02"],
        createdTime: "2026-01-05T00:00:00.000Z",
        mimeType: "application/pdf",
      },
    ],
    { "doc-invoice-a": new Uint8Array(Buffer.from("pdf")) },
  );
  await setDriveParentFolderId("parent");
  await runSweep(driveClient);
  const pdfAccess: PdfAccess = {
    async extractTextLines() {
      return stubTextLinesForDriveFile("doc-invoice-a")!;
    },
    async extractAttachments() {
      return [];
    },
    async extractPageImages() {
      return [];
    },
  };

  const read = new Promise<AppEvent>((resolve) => {
    const unsubscribe = subscribeAppEvents((event) => {
      if (event.type === "document-read") {
        unsubscribe();
        resolve(event);
      }
    });
  });
  // The subscription is ready before the worker can finish.
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(await enqueueMonthExtraction(new BullmqExtractionJobQueue(), 1, "2026_01"), 1);
  const { worker } = startExtractionWorker(
    {
      driveClient,
      pdfAccess,
      qrReader: emptyQrReader(),
      ekasaLookup: new FakeEkasaLookup(),
      ocr: new FakeOcr(),
      extractor: createStubExtractor(),
    },
    1,
  );
  try {
    assert.deepEqual(await read, {
      type: "document-read",
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: "doc-invoice-a",
      outcome: "complete",
    });
    const snapshot = await loadQueueSnapshot();
    assert.deepEqual([snapshot.running.length, snapshot.waiting.length, snapshot.delayed.length], [0, 0, 0]);
    assert.equal(snapshot.recent[0]?.driveFileId, "doc-invoice-a");
    assert.equal(snapshot.recent[0]?.outcome, "complete");
  } finally {
    await worker.close();
  }
});
