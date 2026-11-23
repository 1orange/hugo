import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import {
  BACKLOG_DOCUMENT_PRIORITY,
  RAISED_DOCUMENT_PRIORITY,
  RECENT_DOCUMENT_PRIORITY,
  RECENT_RECEIPT_PRIORITY,
} from "../../../src/adapters/job-queue/port.ts";
import { MemoryExtractionJobQueue } from "../../../src/adapters/job-queue/memory-extraction-queue.ts";
import { listCompanies } from "../../../src/adapters/store/companies.ts";
import { closeMonth } from "../../../src/adapters/store/months.ts";
import { getSettings, setDriveParentFolderId, setReadingWindowStart } from "../../../src/adapters/store/settings.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { documents } from "../../../src/lib/db/schema.ts";
import { enqueueMonthExtraction } from "../../../src/lib/extraction-queue/enqueue.ts";
import { queueReadingWindow, readingKindOf } from "../../../src/lib/extraction-queue/reading-window.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { freshTestDb } from "../support/test-db.ts";

/** 23 November 2026: the open month is November, the booking month October. */
const INSTANT = new Date("2026-11-23T11:00:00.000Z");
const ALL_YEAR_WINDOW = "2026_01";

function folder(id: string, name: string, parent: string | null) {
  return { id, name, parents: parent ? [parent] : [], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME };
}

function file(id: string, name: string, parent: string, mimeType = "application/pdf") {
  return { id, name, parents: [parent], createdTime: "2026-10-05T00:00:00.000Z", mimeType };
}

/**
 * Delta: months August to December, invoices in each, a receipt in October, a
 * photo receipt in November, a bank statement in October, and a December
 * invoice (future). Echo: October only.
 */
function tree() {
  return [
    folder("parent", "Clients", null),
    folder("delta", "Delta s.r.o.", "parent"),
    folder("echo", "Echo s.r.o.", "parent"),
    folder("d07", "2026_07", "delta"),
    folder("d08", "2026_08", "delta"),
    folder("d09", "2026_09", "delta"),
    folder("d10", "2026_10", "delta"),
    folder("d11", "2026_11", "delta"),
    folder("d12", "2026_12", "delta"),
    folder("e10", "2026_10", "echo"),
    folder("d07-02", "02 Prijaté faktúry", "d07"),
    folder("d08-02", "02 Prijaté faktúry", "d08"),
    folder("d09-02", "02 Prijaté faktúry", "d09"),
    folder("d10-02", "02 Prijaté faktúry", "d10"),
    folder("d10-03", "03 Bankové výpisy", "d10"),
    folder("d10-04", "04 Bločky", "d10"),
    folder("d11-02", "02 Prijaté faktúry", "d11"),
    folder("d11-04", "04 Bločky", "d11"),
    folder("d12-02", "02 Prijaté faktúry", "d12"),
    folder("e10-02", "02 Prijaté faktúry", "e10"),
    file("inv-07", "inv-07.pdf", "d07-02"),
    file("inv-08", "inv-08.pdf", "d08-02"),
    file("inv-09", "inv-09.pdf", "d09-02"),
    file("inv-10", "inv-10.pdf", "d10-02"),
    file("stm-10", "stm-10.pdf", "d10-03"),
    file("rec-10", "rec-10.pdf", "d10-04"),
    file("inv-11", "inv-11.pdf", "d11-02"),
    file("photo-11", "photo-11.jpg", "d11-04", "image/jpeg"),
    file("inv-12", "inv-12.pdf", "d12-02"),
    file("echo-10", "echo-10.pdf", "e10-02"),
  ];
}

async function setUp(): Promise<{ deltaId: number; echoId: number }> {
  await freshTestDb();
  await setDriveParentFolderId("parent");
  await runSweep(new FakeDriveClient(tree(), {}));
  const companies = await listCompanies();
  const deltaId = companies.find((company) => company.name === "Delta s.r.o.")!.id;
  const echoId = companies.find((company) => company.name === "Echo s.r.o.")!.id;
  // September is closed: the office has finished it.
  await closeMonth(deltaId, "2026_09", "2026-10-31T10:00:00.000Z");
  return { deltaId, echoId };
}

async function documentStatus(driveFileId: string): Promise<string | undefined> {
  const [row] = await getDb().select().from(documents).where(eq(documents.id, driveFileId)).limit(1);
  return row?.extractionStatus;
}

async function queued(
  queue: MemoryExtractionJobQueue,
  options: { windowStart?: string; raised?: { companyId: number; monthKey: string } | null } = {},
): Promise<number> {
  return queueReadingWindow(queue, {
    windowStart: options.windowStart ?? ALL_YEAR_WINDOW,
    raised: options.raised ?? null,
    instant: INSTANT,
  });
}

test("a document in last month's folder is queued by the next sweep, without its month being opened", async () => {
  await setUp();
  const queue = new MemoryExtractionJobQueue();

  await queued(queue);

  // October is the booking month, so it is recent; the open month is November.
  assert.equal(queue.jobs.get("inv-10")?.priority, RECENT_DOCUMENT_PRIORITY);
  assert.equal(queue.jobs.get("inv-10")?.data.monthKey, "2026_10");
  assert.equal(queue.jobs.get("inv-10")?.data.tier, "recent");
  assert.equal(await documentStatus("inv-10"), "pending", "the document is recorded as being read");
});

test("the window queues recent and backlog months and leaves out closed, future and statement files", async () => {
  await setUp();
  const queue = new MemoryExtractionJobQueue();

  const added = await queued(queue);

  // Booking and current months: October and November. Backlog: August, July.
  // Not queued: September (closed), December (future), the statement.
  assert.deepEqual(
    [...queue.jobs.keys()].sort(),
    ["echo-10", "inv-07", "inv-08", "inv-10", "inv-11", "photo-11", "rec-10"].sort(),
  );
  assert.equal(added, 7);
  assert.equal(queue.jobs.get("rec-10")?.priority, RECENT_RECEIPT_PRIORITY);
  assert.equal(queue.jobs.get("photo-11")?.data.kind, "receipt");
  assert.equal(queue.jobs.get("inv-08")?.priority, BACKLOG_DOCUMENT_PRIORITY);
  assert.equal(queue.jobs.get("inv-08")?.data.tier, "backlog");
  assert.equal(await documentStatus("inv-09"), undefined, "a closed month is not read");
  assert.equal(await documentStatus("inv-12"), undefined, "a future month is not read");
  assert.equal(await documentStatus("stm-10"), undefined, "a statement is never read");
});

test("a backlog month is queued newest first, after the recent tier", async () => {
  await setUp();
  const queue = new MemoryExtractionJobQueue();

  await queued(queue);

  const order = [...queue.jobs.keys()];
  const at = (driveFileId: string) => order.indexOf(driveFileId);
  assert.ok(at("inv-08") < at("inv-07"), "August is queued before July");
  assert.ok(at("inv-07") > at("inv-10"), "the backlog comes after the booking month");
  assert.ok(at("inv-07") > at("echo-10"), "the backlog comes after every recent month");
});

test("the window start is honoured: a month before it is not read in the background", async () => {
  await setUp();
  const queue = new MemoryExtractionJobQueue();

  await queued(queue, { windowStart: "2026_10" });

  assert.deepEqual([...queue.jobs.keys()].sort(), ["echo-10", "inv-10", "inv-11", "photo-11", "rec-10"].sort());
  assert.equal(await documentStatus("inv-08"), undefined);
});

test("opening a month before the window queues and raises it; a closed month opened is not read", async () => {
  const { deltaId } = await setUp();
  const queue = new MemoryExtractionJobQueue();

  await queued(queue, { windowStart: "2026_10", raised: { companyId: deltaId, monthKey: "2026_08" } });
  assert.equal(queue.jobs.get("inv-08")?.priority, RAISED_DOCUMENT_PRIORITY);
  assert.equal(queue.jobs.get("inv-08")?.data.tier, "raised");
  assert.equal(queue.jobs.has("inv-07"), false, "the rest of the window before the start is still left alone");

  const closedQueue = new MemoryExtractionJobQueue();
  await queued(closedQueue, { windowStart: "2026_10", raised: { companyId: deltaId, monthKey: "2026_09" } });
  assert.equal(closedQueue.jobs.has("inv-09"), false, "a closed month is never read, even when opened");
});

test("a file found by a notification, the poll and a page is one job", async () => {
  const { deltaId } = await setUp();
  const queue = new MemoryExtractionJobQueue();

  const first = await queued(queue);
  // The poll and a page that opens the month see the same files.
  const poll = await queued(queue, { raised: { companyId: deltaId, monthKey: "2026_10" } });
  const page = await enqueueMonthExtraction(queue, deltaId, "2026_10");

  assert.equal(first, 7);
  assert.equal(poll, 0);
  assert.equal(page, 0);
  assert.equal(queue.jobs.size, 7);
});

test("the window finds the same documents the per-month path would, for every open month", async () => {
  const { deltaId, echoId } = await setUp();
  // The documents exist once a sweep has placed them: then mark two as read. A
  // document already read is not queued again; one read by an older pipeline is read again.
  await queued(new MemoryExtractionJobQueue());
  const db = getDb();
  await db.update(documents).set({ extractionStatus: "complete", extractionPipelineVersion: 7 }).where(eq(documents.id, "rec-10"));
  await db.update(documents).set({ extractionStatus: "complete", extractionPipelineVersion: 6 }).where(eq(documents.id, "inv-11"));

  const perMonth = new MemoryExtractionJobQueue();
  // Up to the current month: the window never reads ahead, December included.
  const months = ["2026_01", "2026_02", "2026_03", "2026_04", "2026_05", "2026_06", "2026_07", "2026_08", "2026_09", "2026_10", "2026_11"];
  for (const monthKey of months) {
    await enqueueMonthExtraction(perMonth, deltaId, monthKey, () => INSTANT.toISOString());
    await enqueueMonthExtraction(perMonth, echoId, monthKey, () => INSTANT.toISOString());
  }

  const window = new MemoryExtractionJobQueue();
  await queued(window);

  const summarise = (queue: MemoryExtractionJobQueue) =>
    [...queue.jobs.values()]
      .map(({ data }) => `${data.driveFileId}|${data.kind}|${data.companyId}|${data.monthKey}|${data.reread === true}`)
      .sort();
  assert.deepEqual(summarise(window), summarise(perMonth));
  assert.ok(window.jobs.get("inv-11")?.data.reread, "the older read is read again");
  assert.equal(window.jobs.has("rec-10"), false, "a complete document is left alone");
});

test("the window start is stored as the office chose it, and the default is kept as none", async () => {
  await setUp();
  assert.equal((await getSettings()).readingWindowStart, null);

  await setReadingWindowStart("2026_06");
  assert.equal((await getSettings()).readingWindowStart, "2026_06");

  await setReadingWindowStart(null);
  assert.equal((await getSettings()).readingWindowStart, null);
});

test("the reading kind follows the per-month rules: PDFs in receipt and document folders, receipt photos in processed folders", () => {
  assert.equal(readingKindOf({ folderSlot: "02 Prijaté faktúry", mimeType: "application/pdf" }), "document");
  assert.equal(readingKindOf({ folderSlot: "06 Ostatné dokumenty", mimeType: "application/pdf" }), "document");
  assert.equal(readingKindOf({ folderSlot: "04 Bločky", mimeType: "application/pdf" }), "receipt");
  assert.equal(readingKindOf({ folderSlot: "04 Bločky", mimeType: "image/jpeg" }), "receipt");
  assert.equal(readingKindOf({ folderSlot: "01 Vystavené faktúry", mimeType: "image/jpeg" }), "receipt");
  assert.equal(readingKindOf({ folderSlot: "03 Bankové výpisy", mimeType: "application/pdf" }), null);
  assert.equal(readingKindOf({ folderSlot: "05 Iné", mimeType: "application/pdf" }), null);
  assert.equal(readingKindOf({ folderSlot: "02 Prijaté faktúry", mimeType: "application/msword" }), null);
  assert.equal(readingKindOf({ folderSlot: null, mimeType: "application/pdf" }), null);
});
