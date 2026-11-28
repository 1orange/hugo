import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/lib/db/client.ts";
import { files } from "../../../src/lib/db/schema.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { MemoryExtractionJobQueue } from "../../../src/adapters/job-queue/memory-extraction-queue.ts";
import {
  countAwaitingDecision,
  ensureDocumentsForMonth,
  getDocument,
} from "../../../src/adapters/store/documents.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { enqueueMonthExtraction } from "../../../src/lib/extraction-queue/enqueue.ts";
import { confirmDocument, dismissDocument } from "../../../src/lib/documents/service.ts";
import { requestDocumentReextraction } from "../../../src/lib/documents/reextract-document.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import { buildMonthOmegaExport } from "../../../src/lib/omega-export/service.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { freshTestDb } from "../support/test-db.ts";

const INVOICE = "bank-invoice";
const STATEMENT_PDF = "bank-statement-pdf";
const STATEMENT_XML = "bank-statement-xml";
const NOW = "2026-01-12T10:00:00.000Z";

function tree() {
  const folder = (id: string, name: string, parent: string | null) => ({
    id,
    name,
    parents: parent ? [parent] : [],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  });
  const pdf = (id: string, name: string, parent: string, mimeType: string) => ({
    id,
    name: `${name}`,
    parents: [parent],
    createdTime: "2026-01-05T00:00:00.000Z",
    mimeType,
  });
  return [
    folder("parent", "Clients", null),
    folder("company", "Epsilon s.r.o.", "parent"),
    folder("month", "2026_01", "company"),
    folder("slot-02", "02 Prijaté faktúry", "month"),
    folder("slot-03", "03 Bankové výpisy", "month"),
    pdf(INVOICE, "faktura.pdf", "slot-02", "application/pdf"),
    pdf(STATEMENT_PDF, "vypis.pdf", "slot-03", "application/pdf"),
    pdf(STATEMENT_XML, "vypis.xml", "slot-03", "application/xml"),
  ];
}

/** A month swept from Drive: one invoice and two statements, the way the office files them. */
async function sweptMonth() {
  await freshTestDb();
  const driveClient = new FakeDriveClient(
    tree(),
    Object.fromEntries(
      [INVOICE, STATEMENT_PDF, STATEMENT_XML].map((id) => [id, new Uint8Array(Buffer.from("bytes"))]),
    ),
  );
  await setDriveParentFolderId("parent");
  await runSweep(driveClient);
}

async function setFolder(driveFileId: string, folderSlot: string) {
  await getDb().update(files).set({ folderSlot }).where(eq(files.driveFileId, driveFileId));
}

test("a swept statement gets a not-read row and is never queued, while the invoice is", async () => {
  await sweptMonth();
  const queue = new MemoryExtractionJobQueue();

  assert.equal(await enqueueMonthExtraction(queue, 1, "2026_01", () => NOW), 1);

  assert.equal((await getDocument(STATEMENT_PDF))?.extractionStatus, "not-read");
  assert.equal((await getDocument(STATEMENT_XML))?.extractionStatus, "not-read");
  assert.equal((await getDocument(INVOICE))?.extractionStatus, "pending");
  for (const statement of [STATEMENT_PDF, STATEMENT_XML]) {
    assert.equal(queue.jobs.has(statement) || queue.modelJobs.has(statement), false, statement);
  }
  assert.equal(queue.jobs.has(INVOICE) || queue.modelJobs.has(INVOICE), true);

  // A later pass, with the same files, queues nothing new for them either.
  assert.equal(await enqueueMonthExtraction(queue, 1, "2026_01", () => NOW), 0);
  assert.equal(queue.jobs.has(STATEMENT_PDF) || queue.modelJobs.has(STATEMENT_PDF), false);
});

test("a statement moved into a processed folder is read; one moved back is not read again", async () => {
  await sweptMonth();
  await enqueueMonthExtraction(new MemoryExtractionJobQueue(), 1, "2026_01", () => NOW);
  assert.equal((await getDocument(STATEMENT_PDF))?.extractionStatus, "not-read");

  await setFolder(STATEMENT_PDF, "02 Prijaté faktúry");
  await ensureDocumentsForMonth(1, "2026_01", NOW);
  const readable = await getDocument(STATEMENT_PDF);
  assert.equal(readable?.folderSlot, "02 Prijaté faktúry");
  assert.equal(readable?.extractionStatus, "pending");

  await setFolder(STATEMENT_PDF, "03 Bankové výpisy");
  await ensureDocumentsForMonth(1, "2026_01", NOW);
  assert.equal((await getDocument(STATEMENT_PDF))?.extractionStatus, "not-read");
});

test("the month's list shows statements after the proofs, with a decision and no fields", async () => {
  await sweptMonth();
  await enqueueMonthExtraction(new MemoryExtractionJobQueue(), 1, "2026_01", () => NOW);

  const view = await buildMonthDocumentView(1, "2026_01");
  assert.ok(view);
  const ids = view.documents.map((document) => document.id);
  assert.deepEqual(ids.slice(0, 1), [INVOICE]);
  assert.deepEqual(new Set(ids.slice(1)), new Set([STATEMENT_PDF, STATEMENT_XML]));

  const statement = view.documents.find((document) => document.id === STATEMENT_PDF)!;
  assert.equal(statement.folderSlot, "03 Bankové výpisy");
  assert.equal(statement.derivedStatus.kind, "not-read");
  assert.equal(statement.canReextract, false);
  assert.equal(statement.fieldEditor.fields.supplierName, "");
  assert.equal(statement.fieldEditor.fields.amountCents, null);
  assert.ok(view.folderFilters.some((option) => option.slot === "03 Bankové výpisy" && option.count === 2));

  // Both statements wait for her decision, and they count in the month's to-do.
  assert.equal(view.awaitingCount, 3);
});

test("confirming or dismissing a statement moves the month's to-do count", async () => {
  await sweptMonth();
  await enqueueMonthExtraction(new MemoryExtractionJobQueue(), 1, "2026_01", () => NOW);
  assert.equal(await countAwaitingDecision(1, "2026_01"), 3);

  const confirmed = await confirmDocument({
    companyId: 1,
    monthKey: "2026_01",
    documentId: STATEMENT_PDF,
    confirmed: true,
    now: NOW,
  });
  assert.equal(confirmed.ok, true);
  const dismissed = await dismissDocument({
    companyId: 1,
    monthKey: "2026_01",
    documentId: STATEMENT_XML,
    reason: "duplicitný výpis",
    now: NOW,
  });
  assert.equal(dismissed.ok, true);

  const view = await buildMonthDocumentView(1, "2026_01");
  assert.equal(view?.awaitingCount, 1);
  assert.equal(view?.decidedCount, 2);
  assert.equal(await countAwaitingDecision(1, "2026_01"), 1);
});

test("a statement is never sent to a reader again", async () => {
  await sweptMonth();
  await enqueueMonthExtraction(new MemoryExtractionJobQueue(), 1, "2026_01", () => NOW);
  const queue = new MemoryExtractionJobQueue();

  const result = await requestDocumentReextraction({
    companyId: 1,
    monthKey: "2026_01",
    documentId: STATEMENT_PDF,
    schedule: async () => {
      await enqueueMonthExtraction(queue, 1, "2026_01", () => NOW);
    },
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.equal((await getDocument(STATEMENT_PDF))?.extractionStatus, "not-read");
  assert.equal(queue.jobs.has(STATEMENT_PDF) || queue.modelJobs.has(STATEMENT_PDF), false);
});

test("the Omega export leaves a confirmed statement out", async () => {
  await sweptMonth();
  await enqueueMonthExtraction(new MemoryExtractionJobQueue(), 1, "2026_01", () => NOW);
  await confirmDocument({
    companyId: 1,
    monthKey: "2026_01",
    documentId: STATEMENT_PDF,
    confirmed: true,
    now: NOW,
  });

  const { preview } = await buildMonthOmegaExport({
    companyId: 1,
    monthKey: "2026_01",
    register: new FakeCompanyRegister(),
    now: NOW,
    persist: false,
  });

  const exported = [...preview.included, ...preview.heldBack].map((item) => item.documentId);
  assert.equal(exported.includes(STATEMENT_PDF), false);
  assert.equal((await getDocument(STATEMENT_PDF))?.exportNumber ?? null, null);
});
