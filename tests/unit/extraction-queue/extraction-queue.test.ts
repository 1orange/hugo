import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { stubTextLinesForDriveFile } from "../../../src/adapters/extractor/stub-fixtures.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import type { Extractor } from "../../../src/adapters/extractor/port.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { MemoryExtractionJobQueue } from "../../../src/adapters/job-queue/memory-extraction-queue.ts";
import { DOCUMENT_PRIORITY } from "../../../src/adapters/job-queue/port.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { documents } from "../../../src/lib/db/schema.ts";
import { subscribeAppEvents, type AppEvent } from "../../../src/lib/events/bus.ts";
import { enqueueMonthExtraction } from "../../../src/lib/extraction-queue/enqueue.ts";
import { processExtractionJob } from "../../../src/lib/extraction-queue/process-job.ts";
import { labelOf, percentOf, ProgressReporter, type JobProgress } from "../../../src/lib/extraction-queue/progress.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { freshTestDb } from "../support/test-db.ts";

const INVOICES = ["doc-invoice-a", "doc-invoice-b"];

function tree() {
  const folder = (id: string, name: string, parent: string | null) => ({
    id,
    name,
    parents: parent ? [parent] : [],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  });
  return [
    folder("parent", "Clients", null),
    folder("company", "Delta s.r.o.", "parent"),
    folder("month", "2026_01", "company"),
    folder("slot-02", "02 Prijaté faktúry", "month"),
    ...INVOICES.map((id) => ({
      id,
      name: `${id}.pdf`,
      parents: ["slot-02"],
      createdTime: "2026-01-05T00:00:00.000Z",
      mimeType: "application/pdf",
    })),
  ];
}

/** A swept month of two invoices whose text layer is the stub's. */
async function sweptMonth() {
  await freshTestDb();
  const driveClient = new FakeDriveClient(
    tree(),
    Object.fromEntries(INVOICES.map((id) => [id, new Uint8Array(Buffer.from("pdf"))])),
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
  return { driveClient, pdfAccess };
}

function deps(driveClient: FakeDriveClient, pdfAccess: PdfAccess, extractor: Extractor) {
  return {
    driveClient,
    pdfAccess,
    qrReader: emptyQrReader(),
    ekasaLookup: new FakeEkasaLookup(),
    ocr: new FakeOcr(),
    extractor,
    now: () => "2026-01-12T10:00:00.000Z",
  };
}

async function extractionStatus(driveFileId: string): Promise<string | undefined> {
  const [row] = await getDb().select().from(documents).where(eq(documents.driveFileId, driveFileId)).limit(1);
  return row?.extractionStatus;
}

// Page renders, sweeps and the poll all queue the month, on every replica.
test("queuing a month again while its documents are queued adds nothing", async () => {
  await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  const events: AppEvent[] = [];
  const unsubscribe = subscribeAppEvents((event) => events.push(event));

  assert.equal(await enqueueMonthExtraction(queue, 1, "2026_01"), 2);
  assert.equal(await enqueueMonthExtraction(queue, 1, "2026_01"), 0);
  unsubscribe();

  assert.deepEqual([...queue.jobs.keys()].sort(), INVOICES);
  const job = queue.jobs.get("doc-invoice-a")!;
  assert.equal(job.priority, DOCUMENT_PRIORITY);
  assert.equal(job.data.companyName, "Delta s.r.o.");
  assert.equal(job.data.fileName, "doc-invoice-a.pdf");
  assert.equal(await extractionStatus("doc-invoice-a"), "pending");
  // The screens hear once, when something was queued.
  assert.deepEqual(events, [{ type: "queue-changed" }]);
});

test("a job reads its document and reports each stage", async () => {
  const { driveClient, pdfAccess } = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  const stub = createStubExtractor();
  const extractor: Extractor = {
    async extract(input) {
      input.onProgress?.({ promptTotal: 1000, promptProcessed: 1000, generatedTokens: 40 });
      return stub.extract({ ...input, driveFileId: "doc-invoice-a" });
    },
  };
  const flushed: JobProgress[] = [];
  const reporter = new ProgressReporter((progress) => flushed.push(progress));

  const result = await processExtractionJob(
    queue.jobs.get("doc-invoice-a")!.data,
    deps(driveClient, pdfAccess, extractor),
    reporter,
  );

  assert.deepEqual(result, { outcome: "complete", reason: null });
  assert.equal(await extractionStatus("doc-invoice-a"), "complete");
  assert.deepEqual(
    flushed.map((progress) => progress.stage),
    ["text", "model"],
  );
  assert.equal(labelOf(reporter.current), "Model píše odpoveď · 40 tokenov");
  const percent = percentOf(reporter.current, Date.now());
  assert.ok(percent > 65 && percent < 100, String(percent));
});

test("a document whose model is down waits, with the reason", async () => {
  const { driveClient, pdfAccess } = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  const down: Extractor = {
    async extract() {
      throw new Error("Extractor is unreachable: EXTRACTOR_URL and EXTRACTOR_MODEL are not set.");
    },
  };

  const result = await processExtractionJob(
    queue.jobs.get("doc-invoice-b")!.data,
    deps(driveClient, pdfAccess, down),
    new ProgressReporter(() => {}),
  );

  assert.equal(result.outcome, "waiting");
  assert.match(result.reason ?? "", /EXTRACTOR_URL/);
  assert.equal(await extractionStatus("doc-invoice-b"), "pending");
});

test("a file Drive will not give fails its document, with the reason", async () => {
  const { pdfAccess } = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  const noFiles = new FakeDriveClient(tree(), {});

  const result = await processExtractionJob(
    queue.jobs.get("doc-invoice-a")!.data,
    deps(noFiles, pdfAccess, createStubExtractor()),
    new ProgressReporter(() => {}),
  );

  assert.equal(result.outcome, "failed");
  assert.match(result.reason ?? "", /Reading the document failed/);
});

test("the bar never goes back when a later stage starts lower", () => {
  let now = 0;
  const reporter = new ProgressReporter(() => {}, () => now);
  reporter.stage("model");
  reporter.model({ promptTotal: 1000, promptProcessed: 1000, generatedTokens: 200 });
  now = 1000;
  const before = percentOf(reporter.current, now);
  // A receipt's QR retry after the model: the bar stays where it was.
  reporter.stage("qr");
  assert.ok(percentOf(reporter.current, now) >= before);
});
