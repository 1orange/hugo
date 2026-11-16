import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { stubTextLinesForDriveFile } from "../../../src/adapters/extractor/stub-fixtures.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import type { Extractor, ExtractorInput, ExtractorOutput } from "../../../src/adapters/extractor/port.ts";
import type { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { MemoryExtractionJobQueue } from "../../../src/adapters/job-queue/memory-extraction-queue.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import {
  getDocument,
  markForReextraction,
  writeExtractedPayload,
} from "../../../src/adapters/store/documents.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { documents, events } from "../../../src/lib/db/schema.ts";
import type { CashDiscoveryDeps } from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import { enqueueMonthExtraction } from "../../../src/lib/extraction-queue/enqueue.ts";
import { processExtractionJob } from "../../../src/lib/extraction-queue/process-job.ts";
import { processModelJob } from "../../../src/lib/extraction-queue/process-model-job.ts";
import { ProgressReporter } from "../../../src/lib/extraction-queue/progress.ts";
import { modelBecameReady, servicesBackOnline, serviceReadiness } from "../../../src/lib/extraction-queue/service-health.ts";
import { isModelExtractedPayload, parseExtractedPayload } from "../../../src/modules/document-payload.ts";
import { syntheticEkasaOpdResponse } from "../cash-discovery/synthetic-ekasa-opd.ts";
import { SYNTHETIC_FIXTURE } from "../cash-discovery/synthetic-ekasa-lines.ts";
import {
  DOCS,
  LANE_NOW,
  OCR_BOXES,
  pdfFor,
  sweptMonth,
  type Doc,
} from "./lane-fixtures.ts";

const SLOT_02 = "02 Prijaté faktúry";
const NOW = LANE_NOW;

/** An extractor that counts the documents it is asked about, then answers as the stub does. */
function countingExtractor(inner: Extractor = createStubExtractor()) {
  const asked: string[] = [];
  const extractor: Extractor = {
    async extract(input: ExtractorInput): Promise<ExtractorOutput> {
      asked.push(input.driveFileId);
      return inner.extract(input);
    },
  };
  return { extractor, asked };
}

const DOWN: Extractor = {
  async extract() {
    throw new Error("Extractor is unreachable: EXTRACTOR_URL and EXTRACTOR_MODEL are not set.");
  },
};

function deps(
  driveClient: FakeDriveClient,
  options: { extractor?: Extractor; ocr?: FakeOcr; docs?: Record<string, Doc> } = {},
): CashDiscoveryDeps {
  return {
    driveClient,
    pdfAccess: pdfFor(options.docs ?? DOCS),
    qrReader: emptyQrReader(),
    ekasaLookup: new FakeEkasaLookup({
      responses: { [SYNTHETIC_FIXTURE.uid]: { ok: true, raw: syntheticEkasaOpdResponse() } },
    }),
    ocr: options.ocr ?? new FakeOcr({ boxes: OCR_BOXES }),
    extractor: options.extractor ?? createStubExtractor(),
    now: () => NOW,
  };
}

/** The reading lane's turn for one queued file. */
function readLane(
  queue: MemoryExtractionJobQueue,
  driveFileId: string,
  laneDeps: CashDiscoveryDeps,
  reporter = new ProgressReporter(() => {}),
) {
  return processExtractionJob(queue.jobs.get(driveFileId)!.data, laneDeps, reporter, (job) => queue.handOff(job));
}

/** The model lane's turn for one handed-over document. */
function modelLane(
  queue: MemoryExtractionJobQueue,
  driveFileId: string,
  extractor: Extractor,
  reporter = new ProgressReporter(() => {}),
) {
  return processModelJob(queue.modelJobs.get(driveFileId)!.data, { extractor }, reporter);
}

async function row(driveFileId: string) {
  const found = await getDocument(driveFileId);
  assert.ok(found, `no document for ${driveFileId}`);
  return found;
}

async function seedPrior(driveFileId: string, documentNumber: string) {
  await writeExtractedPayload(
    driveFileId,
    {
      kind: "extracted",
      parties: [],
      documentNumber,
      variableSymbol: null,
      issueDate: null,
      taxableSupplyDate: null,
      dueDate: null,
      currency: "EUR",
      amountCents: 100,
      amountLiteral: "1.00",
      vatRecap: [],
      docTypeHint: "invoice",
    },
    "complete",
    null,
  );
  await getDb().update(documents).set({ extractionPipelineVersion: 2 }).where(eq(documents.id, driveFileId));
}

function documentNumberOf(json: string): string | null {
  const payload = parseExtractedPayload(json);
  return isModelExtractedPayload(payload) ? payload.documentNumber : null;
}

test("an eKasa receipt is finished in the reading lane, without the model", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  const { extractor, asked } = countingExtractor();

  const result = await readLane(queue, "doc-receipt", deps(driveClient, { extractor }));

  assert.deepEqual(result, { outcome: "complete", reason: null });
  assert.equal((await row("doc-receipt")).extractionStatus, "complete");
  assert.deepEqual(asked, []);
  assert.equal(queue.modelJobs.size, 0);
});

test("an ISDOC invoice is finished in the reading lane, without the model", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  const { extractor, asked } = countingExtractor();

  const result = await readLane(queue, "doc-isdoc", deps(driveClient, { extractor }));

  assert.deepEqual(result, { outcome: "complete", reason: null });
  const payload = parseExtractedPayload((await row("doc-isdoc")).extractedPayloadJson);
  assert.ok(isModelExtractedPayload(payload) && payload.source === "isdoc");
  assert.deepEqual(asked, []);
  assert.equal(queue.modelJobs.size, 0);
});

test("a document that needs the model is handed over with its lines, and is not downloaded again", async () => {
  const driveClient = await sweptMonth();
  const downloads: string[] = [];
  const download = driveClient.download.bind(driveClient);
  driveClient.download = async (fileId) => {
    downloads.push(fileId);
    return download(fileId);
  };
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");

  const handed = await readLane(queue, "doc-invoice-a", deps(driveClient));

  assert.deepEqual(handed, { outcome: "handed", reason: null });
  assert.equal((await row("doc-invoice-a")).extractionStatus, "pending");
  const job = queue.modelJobs.get("doc-invoice-a")!;
  assert.deepEqual(job.data.lines, stubTextLinesForDriveFile("doc-invoice-a"));
  assert.equal(job.data.source, "model");
  assert.equal(job.data.folderSlot, SLOT_02);
  assert.equal(job.data.kind, "document");
  assert.equal(typeof job.data.readStartedAt, "number");

  const { extractor, asked } = countingExtractor();
  assert.equal((await modelLane(queue, "doc-invoice-a", extractor)).outcome, "complete");
  assert.deepEqual(asked, ["doc-invoice-a"]);
  assert.deepEqual(downloads, ["doc-invoice-a"]);
  assert.equal((await row("doc-invoice-a")).extractionStatus, "complete");
});

test("a scanned document is OCR'd in the reading lane, and the model gets the OCR lines", async () => {
  const driveClient = await sweptMonth();
  const ocr = new FakeOcr({ boxes: OCR_BOXES });
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");

  const handed = await readLane(queue, "doc-scan", deps(driveClient, { ocr }));

  assert.equal(handed.outcome, "handed");
  assert.equal(ocr.calls.length, 1);
  const job = queue.modelJobs.get("doc-scan")!;
  assert.equal(job.data.source, "ocr");
  assert.ok(job.data.lines.some((line) => line.includes("100.00")), JSON.stringify(job.data.lines));
});

test("an OCR outage waits in the reading lane, and the model lane has nothing of the document", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");

  const result = await readLane(queue, "doc-scan", deps(driveClient, { ocr: new FakeOcr({ unreachable: true }) }));

  assert.equal(result.outcome, "waiting");
  assert.match(result.reason ?? "", /OCR is unreachable/);
  assert.equal((await row("doc-scan")).extractionStatus, "pending");
  assert.equal(queue.modelJobs.has("doc-scan"), false);
});

test("a model outage leaves the document waiting in the model lane, and the reading lane goes on", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");

  assert.equal((await readLane(queue, "doc-invoice-a", deps(driveClient))).outcome, "handed");
  queue.finish("doc-invoice-a");
  const waiting = await modelLane(queue, "doc-invoice-a", DOWN);

  assert.equal(waiting.outcome, "waiting");
  assert.match(waiting.reason ?? "", /EXTRACTOR_URL/);
  assert.equal((await row("doc-invoice-a")).extractionStatus, "pending");
  assert.equal(queue.modelJobs.has("doc-invoice-a"), true);

  // While the model is down the reading lane finishes the documents it can.
  assert.deepEqual(await readLane(queue, "doc-isdoc", deps(driveClient)), { outcome: "complete", reason: null });
  assert.deepEqual(await readLane(queue, "doc-receipt", deps(driveClient)), { outcome: "complete", reason: null });
});

test("a document queued twice is read once, from either lane", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");

  // Queued again while waiting to be read: nothing new.
  assert.equal(await enqueueMonthExtraction(queue, 1, "2026_01"), 0);

  await readLane(queue, "doc-invoice-a", deps(driveClient));
  // Handed over once; a second hand-over finds the model lane's job.
  assert.equal(
    await queue.handOff(queue.modelJobs.get("doc-invoice-a")!.data),
    false,
  );
  // The reading job is still there in this fake until finished; once finished,
  // the model lane alone keeps the document from being read again.
  queue.finish("doc-invoice-a");
  assert.equal(await enqueueMonthExtraction(queue, 1, "2026_01"), 0);
  assert.equal(queue.jobs.has("doc-invoice-a"), false);
  assert.equal(queue.modelJobs.has("doc-invoice-a"), true);
});

test("a re-read keeps its prior result until the model lane writes the new one, then commits there", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  await seedPrior("doc-invoice-a", "OLD");
  await markForReextraction("doc-invoice-a");

  assert.equal((await readLane(queue, "doc-invoice-a", deps(driveClient))).outcome, "handed");
  const during = await row("doc-invoice-a");
  assert.equal(during.extractionStatus, "pending");
  assert.equal(during.replacementPending, true);
  assert.equal(documentNumberOf(during.extractedPayloadJson), "OLD");

  const { extractor } = countingExtractor();
  assert.equal((await modelLane(queue, "doc-invoice-a", extractor)).outcome, "complete");
  const after = await row("doc-invoice-a");
  assert.equal(after.replacementPending, false);
  assert.equal(after.extractionStatus, "complete");
  assert.notEqual(documentNumberOf(after.extractedPayloadJson), "OLD");
  const commits = await getDb().select().from(events).where(eq(events.type, "ReextractionCompleted"));
  assert.equal(commits.length, 1);
});

test("a re-read finished in the reading lane commits there, without the model", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  await seedPrior("doc-isdoc", "OLD");
  await markForReextraction("doc-isdoc");

  const result = await readLane(queue, "doc-isdoc", deps(driveClient));

  assert.deepEqual(result, { outcome: "complete", reason: null });
  const after = await row("doc-isdoc");
  assert.equal(after.replacementPending, false);
  const payload = parseExtractedPayload(after.extractedPayloadJson);
  assert.ok(isModelExtractedPayload(payload) && payload.source === "isdoc");
  assert.equal(queue.modelJobs.size, 0);
});

test("a re-read interrupted by a model outage fails in the model lane, keeping the prior result", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  await seedPrior("doc-invoice-a", "OLD");
  await markForReextraction("doc-invoice-a");
  await readLane(queue, "doc-invoice-a", deps(driveClient));

  const result = await modelLane(queue, "doc-invoice-a", DOWN);

  assert.equal(result.outcome, "failed");
  assert.match(result.reason ?? "", /EXTRACTOR_URL/);
  const after = await row("doc-invoice-a");
  assert.equal(after.replacementPending, false);
  assert.equal(documentNumberOf(after.extractedPayloadJson), "OLD");
});

test("a re-read interrupted by an OCR outage fails in the reading lane, keeping the prior result", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  await seedPrior("doc-scan", "OLD");
  await markForReextraction("doc-scan");

  const result = await readLane(queue, "doc-scan", deps(driveClient, { ocr: new FakeOcr({ unreachable: true }) }));

  assert.equal(result.outcome, "failed");
  assert.match(result.reason ?? "", /OCR is unreachable/);
  const after = await row("doc-scan");
  assert.equal(after.replacementPending, false);
  assert.equal(documentNumberOf(after.extractedPayloadJson), "OLD");
});

test("the service that came back is the one whose lane retries", () => {
  const both = { model: true, ocr: true };
  const modelDown = { model: false, ocr: true };
  const ocrDown = { model: true, ocr: false };

  // The first check has no earlier state to come back from.
  assert.deepEqual(servicesBackOnline(null, both), { model: false, ocr: false });
  assert.deepEqual(servicesBackOnline(modelDown, both), { model: true, ocr: false });
  assert.deepEqual(servicesBackOnline(ocrDown, both), { model: false, ocr: true });
  assert.deepEqual(servicesBackOnline(both, modelDown), { model: false, ocr: false });
  assert.deepEqual(servicesBackOnline({ model: false, ocr: false }, both), { model: true, ocr: true });
});

test("the model is asked for its slots when it becomes ready, including at the first check", () => {
  const ready = { model: true, ocr: true };
  const down = { model: false, ocr: true };

  // The first check, and a model that was down: asked again. A model that stays ready: not.
  assert.equal(modelBecameReady(null, ready), true);
  assert.equal(modelBecameReady(down, ready), true);
  assert.equal(modelBecameReady(ready, ready), false);
  assert.equal(modelBecameReady(ready, down), false);
  assert.equal(modelBecameReady(null, down), false);
});

test("a service is ready when it answers ok or is a stub", () => {
  const services = (model: string, ocr: string) =>
    ({
      model: { state: model, url: null, model: null, detail: null },
      ocr: { state: ocr, url: null, detail: null },
    }) as Parameters<typeof serviceReadiness>[0];
  assert.deepEqual(serviceReadiness(services("ok", "stub")), { model: true, ocr: true });
  assert.deepEqual(serviceReadiness(services("loading", "down")), { model: false, ocr: false });
});

test("a file that is not a PDF fails in the reading lane, without the model", async () => {
  const driveClient = await sweptMonth();
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  queue.jobs.get("doc-isdoc")!.data.mimeType = "image/png";
  const result = await readLane(queue, "doc-isdoc", deps(driveClient));
  assert.equal(result.outcome, "failed");
  assert.equal(queue.modelJobs.size, 0);
});
