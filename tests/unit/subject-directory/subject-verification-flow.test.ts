import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { stubTextLinesForDriveFile } from "../../../src/adapters/extractor/stub-fixtures.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import type { Extractor } from "../../../src/adapters/extractor/port.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { MemoryExtractionJobQueue } from "../../../src/adapters/job-queue/memory-extraction-queue.ts";
import { MemorySubjectVerificationQueue } from "../../../src/adapters/job-queue/memory-subject-verification-queue.ts";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { ensureDocumentsForMonth, getDocument, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, files, months } from "../../../src/lib/db/schema.ts";
import { enqueueMonthExtraction } from "../../../src/lib/extraction-queue/enqueue.ts";
import { processExtractionJob } from "../../../src/lib/extraction-queue/process-job.ts";
import { ProgressReporter } from "../../../src/lib/extraction-queue/progress.ts";
import { saveDocumentFields, swapDocumentParties } from "../../../src/lib/documents/service.ts";
import { buildMonthDocumentView, type DocumentListItem } from "../../../src/lib/documents/view.ts";
import { useSubjectVerificationQueue } from "../../../src/lib/subject-directory/queue.ts";
import { queueSubjectChecksForMonth } from "../../../src/lib/subject-directory/schedule.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import type { DirectoryDeps } from "../../../src/lib/subject-directory/service.ts";
import { verifyDocumentParties } from "../../../src/lib/subject-directory/verify-document.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import type { DocumentFieldFormInput, EditableDocumentFields } from "../../../src/modules/document-fields.ts";
import {
  PARTY_SWAP_FIELDS,
  swapParties,
  type PartySwapProvenance,
  type PartySwapValues,
} from "../../../src/modules/party-swap.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { parsePartyIntegrityRecord } from "../../../src/modules/subject-integrity.ts";
import { freshTestDb } from "../support/test-db.ts";

const DELTA_FOLDER = "flow-company";
const MONTH_FOLDER = "flow-month";
const SLOT_02 = "flow-slot-02";
const INVOICE = "flow-invoice";
const START = "2026-02-01T00:00:00.000Z";
const MINUTE = 60_000;

// Her company: the client, on the customer side of a received invoice.
// The IČ DPH is divisible by 11, as a Slovak VAT ID must be.
const CLIENT = { name: "Delta s.r.o.", ico: "31333532", dic: "2020311337", icDph: "SK2020311337" };
// The supplier: a counterparty the register knows.
const SUPPLIER = { name: "Alfa s.r.o.", ico: "31322832", dic: "2020322832", icDph: "" };
const ALFA_REGISTER = {
  country: "SK" as const,
  ico: "31322832",
  legalName: "Alfa s.r.o.",
  address: "Bratislava",
  dic: "2020322832",
  status: "active" as const,
};

const EXTRACTION: ModelExtractedPayload = {
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

let now = START;

function deps(register: FakeCompanyRegister): DirectoryDeps {
  return {
    register,
    vat: new FakeVatRegister(),
    lock: new InProcessLookupLock(),
    limiter: createLookupRateLimiter({ perMinute: 1000 }),
    refreshDays: 30,
    now: () => now,
    waitMs: 5000,
  };
}

async function seedInvoice(): Promise<void> {
  await freshTestDb();
  now = START;
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: DELTA_FOLDER, name: "Delta s.r.o.", active: true });
  await db.insert(months).values({
    id: 1,
    companyId: 1,
    monthKey: "2026_02",
    driveFolderId: MONTH_FOLDER,
    closedAt: null,
    openedAt: START,
  });
  await db.insert(files).values({
    driveFileId: INVOICE,
    companyId: 1,
    monthKey: "2026_02",
    folderSlot: "02 Prijaté faktúry",
    parentId: SLOT_02,
    name: "invoice.pdf",
    mimeType: "application/pdf",
    driveCreatedTime: START,
    firstSeenAt: START,
    lastSeenAt: START,
    deleted: false,
  });
  await ensureDocumentsForMonth(1, "2026_02", START);
  await writeExtractedPayload(INVOICE, EXTRACTION, "complete", null);
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

async function invoiceItem(): Promise<DocumentListItem> {
  const view = await buildMonthDocumentView(1, "2026_02");
  const item = view!.documents.find((document) => document.id === INVOICE);
  assert.ok(item, "invoice is listed");
  return item;
}

function valuesOf(fields: EditableDocumentFields): PartySwapValues {
  return Object.fromEntries(PARTY_SWAP_FIELDS.map((field) => [field, fields[field]])) as PartySwapValues;
}

function provenanceOf(item: DocumentListItem): PartySwapProvenance {
  return Object.fromEntries(
    PARTY_SWAP_FIELDS.map((field) => [field, item.fieldEditor.provenance[field]]),
  ) as PartySwapProvenance;
}

/** The panel's form as it would be saved: every field as the document shows it. */
function formFrom(
  fields: EditableDocumentFields,
  parties: PartySwapValues,
  overrides: Partial<DocumentFieldFormInput> = {},
): DocumentFieldFormInput {
  return {
    exportSection: "",
    ...parties,
    documentNumber: fields.documentNumber,
    variableSymbol: fields.variableSymbol,
    issueDateRaw: fields.issueDateRaw,
    taxableSupplyDateRaw: fields.taxableSupplyDateRaw,
    dueDateRaw: fields.dueDateRaw,
    receiptNumber: fields.receiptNumber,
    receiptTimestampRaw: fields.receiptTimestampRaw,
    currency: fields.currency,
    amountLiteral: fields.amountLiteral,
    recapBaseLiteral: fields.recapBaseLiteral,
    recapVatLiteral: fields.recapVatLiteral,
    vatRecap: fields.vatRecap.map((row) => ({
      rateLiteral: row.rateLiteral,
      baseLiteral: row.baseLiteral,
      vatLiteral: row.vatLiteral,
    })),
    ...overrides,
  };
}

function supplierVerdict(item: DocumentListItem) {
  return item.fieldEditor.partyIntegrity.supplier;
}

function customerVerdict(item: DocumentListItem) {
  return item.fieldEditor.partyIntegrity.customer;
}

async function storedRecord() {
  return parsePartyIntegrityRecord((await getDocument(INVOICE))!.partyIntegrityJson);
}

test("the worker checks the counterparty against the register and stores both verdicts", async () => {
  await seedInvoice();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });

  const record = await verifyDocumentParties(INVOICE, deps(register));

  assert.equal(record?.supplier.verdict, "verified", "the register confirms the supplier's name");
  assert.equal(record?.customer.verdict, "verified", "her own party is confirmed by her profile");
  assert.deepEqual(register.lookupCalls, [{ ico: SUPPLIER.ico, country: "SK" }], "the client was never looked up");
  assert.deepEqual(await storedRecord(), record);
});

test("a page reads the stored verdict and calls no register", async () => {
  await seedInvoice();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  await verifyDocumentParties(INVOICE, deps(register));
  const calls = register.lookupCalls.length;

  const item = await invoiceItem();

  assert.equal(item.fieldEditor.partyIntegrityStored, true);
  assert.equal(supplierVerdict(item).verdict, "verified");
  assert.equal(customerVerdict(item).verdict, "verified");
  assert.equal(register.lookupCalls.length, calls, "building the view made no register call");
});

test("before the worker has checked it, a page judges offline and says so", async () => {
  await seedInvoice();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });

  const item = await invoiceItem();

  assert.equal(item.fieldEditor.partyIntegrityStored, false);
  assert.equal(supplierVerdict(item).verdict, "valid", "formally correct, not confirmed");
  assert.equal(customerVerdict(item).verdict, "verified");
  assert.equal(register.lookupCalls.length, 0);
});

test("an identity edit makes the stored verdict stale until the worker checks again", async () => {
  await seedInvoice();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  await verifyDocumentParties(INVOICE, deps(register));
  const queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);
  try {
    const item = await invoiceItem();
    const renamed = { ...valuesOf(item.fieldEditor.fields), supplierName: "Alfa Holding s.r.o." };
    assert.deepEqual(
      await saveDocumentFields({
        companyId: 1,
        monthKey: "2026_02",
        documentId: INVOICE,
        fields: formFrom(item.fieldEditor.fields, renamed),
      }),
      { ok: true },
    );
    assert.deepEqual([...queue.jobs.keys()], [INVOICE], "the changed party is queued for a check");

    const stale = await invoiceItem();
    assert.equal(stale.fieldEditor.partyIntegrityStored, false, "the old verdict is not shown for new values");

    const calls = register.lookupCalls.length;
    const record = await verifyDocumentParties(INVOICE, deps(register));
    assert.equal(record?.supplier.verdict, "mismatch");
    assert.deepEqual(
      record?.supplier.findings.map((finding) => [finding.code, finding.expected]),
      [["register-name", "Alfa s.r.o."]],
    );
    assert.equal(register.lookupCalls.length, calls, "the directory already knew this subject: no new call");

    const fresh = await invoiceItem();
    assert.equal(fresh.fieldEditor.partyIntegrityStored, true);
    assert.equal(supplierVerdict(fresh).verdict, "mismatch");
  } finally {
    useSubjectVerificationQueue(null);
  }
});

test("a swap of the parties is an identity edit too", async () => {
  await seedInvoice();
  const queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);
  try {
    const item = await invoiceItem();
    const swapped = swapParties(valuesOf(item.fieldEditor.fields), provenanceOf(item));

    assert.deepEqual(
      await swapDocumentParties({
        companyId: 1,
        monthKey: "2026_02",
        documentId: INVOICE,
        fields: formFrom(item.fieldEditor.fields, swapped.draft),
        partyProvenance: swapped.provenance,
        now: START,
      }),
      { ok: true },
    );
    assert.deepEqual([...queue.jobs.keys()], [INVOICE]);
  } finally {
    useSubjectVerificationQueue(null);
  }
});

test("an ordinary edit that changes no party value queues nothing", async () => {
  await seedInvoice();
  const queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);
  try {
    const item = await invoiceItem();
    assert.deepEqual(
      await saveDocumentFields({
        companyId: 1,
        monthKey: "2026_02",
        documentId: INVOICE,
        fields: formFrom(item.fieldEditor.fields, valuesOf(item.fieldEditor.fields), { documentNumber: "FA-2" }),
      }),
      { ok: true },
    );
    assert.equal(queue.jobs.size, 0);
  } finally {
    useSubjectVerificationQueue(null);
  }
});

test("a month is queued for the documents with no current verdict, and retried once a register was unreachable", async () => {
  await seedInvoice();
  const queue = new MemorySubjectVerificationQueue();
  assert.equal(await queueSubjectChecksForMonth(1, "2026_02", queue, START), 1);

  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  register.failure = new Error("RPO search failed: HTTP 503");
  await verifyDocumentParties(INVOICE, deps(register));
  assert.equal((await storedRecord())?.supplier.verdict, "unavailable");

  const soon = new MemorySubjectVerificationQueue();
  assert.equal(await queueSubjectChecksForMonth(1, "2026_02", soon, new Date(Date.parse(START) + 5 * MINUTE).toISOString()), 0);
  assert.equal(
    await queueSubjectChecksForMonth(1, "2026_02", soon, new Date(Date.parse(START) + 11 * MINUTE).toISOString()),
    1,
    "ten minutes later the register is asked again",
  );

  register.failure = null;
  const checked = new MemorySubjectVerificationQueue();
  await verifyDocumentParties(INVOICE, deps(register));
  assert.equal(await queueSubjectChecksForMonth(1, "2026_02", checked, START), 0, "a current verdict is not checked again");
});

test("a register outage leaves the document checkable: its supplier is unavailable, the client still verified", async () => {
  await seedInvoice();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  register.failure = new Error("RPO search failed: HTTP 503");

  await verifyDocumentParties(INVOICE, deps(register));
  const item = await invoiceItem();

  assert.equal(supplierVerdict(item).verdict, "unavailable");
  assert.equal(customerVerdict(item).verdict, "verified");
  assert.equal(item.decision, null, "the document is still open for her");
});

test("the extraction of a file queues the party checks of its documents", async () => {
  await freshTestDb();
  const driveClient = new FakeDriveClient(
    [
      { id: "parent", name: "Clients", parents: [], createdTime: START, mimeType: FOLDER_MIME },
      { id: "company", name: "Delta s.r.o.", parents: ["parent"], createdTime: START, mimeType: FOLDER_MIME },
      { id: "month", name: "2026_01", parents: ["company"], createdTime: START, mimeType: FOLDER_MIME },
      { id: "slot-02", name: "02 Prijaté faktúry", parents: ["month"], createdTime: START, mimeType: FOLDER_MIME },
      { id: "doc-invoice-a", name: "doc-invoice-a.pdf", parents: ["slot-02"], createdTime: START, mimeType: "application/pdf" },
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
    async renderPages() {
      return [];
    },
  };
  const queue = new MemoryExtractionJobQueue();
  await enqueueMonthExtraction(queue, 1, "2026_01");
  const stub = createStubExtractor();
  const extractor: Extractor = {
    async extract(input) {
      return stub.extract({ ...input, driveFileId: "doc-invoice-a" });
    },
  };
  const checks = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(checks);
  try {
    const result = await processExtractionJob(
      queue.jobs.get("doc-invoice-a")!.data,
      {
        driveClient,
        pdfAccess,
        qrReader: emptyQrReader(),
        ekasaLookup: new FakeEkasaLookup(),
        ocr: new FakeOcr(),
        extractor,
        now: () => START,
      },
      new ProgressReporter(() => undefined),
    );

    assert.equal(result.outcome, "complete");
    assert.deepEqual([...checks.jobs.keys()], ["doc-invoice-a"]);
    assert.equal(checks.jobs.get("doc-invoice-a")!.driveFileId, "doc-invoice-a");
  } finally {
    useSubjectVerificationQueue(null);
  }
});

test("a document that is still unread has no party checks to queue", async () => {
  await seedInvoice();
  await getDb().update(documents).set({ extractionStatus: "pending" }).where(eq(documents.id, INVOICE));
  const queue = new MemorySubjectVerificationQueue();

  assert.equal(await queueSubjectChecksForMonth(1, "2026_02", queue, START), 0);
});
