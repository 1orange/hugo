import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import {
  companies,
  documents,
  months,
  files,
} from "../../../src/lib/db/schema.ts";
import {
  discoverCashPaymentsForMonth,
  processCashReceiptFile,
} from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import {
  syntheticEkasaLines,
  SYNTHETIC_FIXTURE,
} from "./synthetic-ekasa-lines.ts";
import { failingEkasaLookup, FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import { emptyQrReader, FakeQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import type { PdfPageImage } from "../../../src/adapters/pdf/port.ts";
import { isEkasaPayload, parseExtractedPayload } from "../../../src/modules/document-payload.ts";
import { syntheticEkasaOpdResponse } from "./synthetic-ekasa-opd.ts";
import { events } from "../../../src/lib/db/schema.ts";
import { ensureDocumentsForMonth } from "../../../src/adapters/store/documents.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";

const PARENT_ID = "cash-parent";
const COMPANY_ID = "cash-company";
const MONTH_ID = "cash-month";
const SLOT_04_ID = "cash-slot-04";
const RECEIPT_ID = "cash-receipt-doc";

const fixtureTree = [
  {
    id: PARENT_ID,
    name: "Clients",
    parents: [] as string[],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: COMPANY_ID,
    name: "Delta s.r.o.",
    parents: [PARENT_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: MONTH_ID,
    name: "2026_01",
    parents: [COMPANY_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: SLOT_04_ID,
    name: "04 Bločky_hotovosť",
    parents: [MONTH_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: RECEIPT_ID,
    name: "fixture-blocek.pdf",
    parents: [SLOT_04_ID],
    createdTime: "2026-01-12T00:00:00.000Z",
    mimeType: "application/pdf",
  },
];

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-cash-")),
    "test.db",
  );
}

function syntheticPdfAccess(
  lines: string[],
  pageImages: PdfPageImage[] = [],
): PdfAccess {
  return {
    async extractTextLines() {
      return lines;
    },
    async extractPageImages() {
      return pageImages;
    },
  };
}

test("fixture eBloček produces one document with expected ekasa payload", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const pdfBytes = new Uint8Array(Buffer.from("fixture-pdf"));
  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: pdfBytes,
  });

  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);

  const deps = {
    driveClient,
    pdfAccess: syntheticPdfAccess(syntheticEkasaLines()),
    qrReader: emptyQrReader(),
    ekasaLookup: failingEkasaLookup(),
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T10:00:00.000Z",
  };

  await discoverCashPaymentsForMonth(1, "2026_01", deps);
  await discoverCashPaymentsForMonth(1, "2026_01", deps);

  const db = getDb();
  const documentRows = db.select().from(documents).all();
  assert.equal(documentRows.length, 1);
  const row = documentRows[0]!;
  assert.equal(row.driveFileId, RECEIPT_ID);
  assert.equal(row.extractionStatus, "complete");

  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), true);
  if (isEkasaPayload(payload)) {
    assert.equal(payload.amountLiteral, SYNTHETIC_FIXTURE.totalLiteral);
    assert.equal(payload.amountCents, SYNTHETIC_FIXTURE.totalCents);
    assert.equal(payload.receiptTimestampRaw, SYNTHETIC_FIXTURE.timestampRaw);
    assert.equal(payload.receiptAt, SYNTHETIC_FIXTURE.receiptAtUtc);
    assert.equal(payload.ekasaUid, SYNTHETIC_FIXTURE.uid);
    assert.equal(payload.ekasaOkp, SYNTHETIC_FIXTURE.okp);
    assert.equal(payload.lineItems.length, 2);
    assert.equal(payload.vatRecap.length, 1);
    assert.equal(payload.source, "text-layer");
  }
});

test("a receipt in the card folder is extracted, not only the cash folder", async () => {
  // Every eBloček in the real corpus sits in `05 Bločky_firemná karta`; `04` holds
  // none. Scoping extraction to the cash folder matched nothing on real data, and
  // the original fixtures all used `04`, so they agreed with the bug.
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const SLOT_05_ID = "card-slot-05";
  const CARD_RECEIPT_ID = "card-receipt-doc";
  const pdfBytes = new Uint8Array(Buffer.from("fixture-pdf"));
  const driveClient = new FakeDriveClient(
    [
      ...fixtureTree.filter((node) => node.id !== RECEIPT_ID),
      {
        id: SLOT_05_ID,
        name: "05 Bločky_firemná karta",
        parents: [MONTH_ID],
        createdTime: "2026-01-01T00:00:00.000Z",
        mimeType: FOLDER_MIME,
      },
      {
        id: CARD_RECEIPT_ID,
        name: "fixture-blocek-card.pdf",
        parents: [SLOT_05_ID],
        createdTime: "2026-01-12T00:00:00.000Z",
        mimeType: "application/pdf",
      },
    ],
    { [CARD_RECEIPT_ID]: pdfBytes },
  );

  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);

  await discoverCashPaymentsForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess(syntheticEkasaLines()),
    qrReader: emptyQrReader(),
    ekasaLookup: failingEkasaLookup(),
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const row = getDb()
    .select()
    .from(documents)
    .where(eq(documents.driveFileId, CARD_RECEIPT_ID))
    .get();
  assert.ok(row, "no document row for the card-folder receipt");
  assert.equal(row.extractionStatus, "complete");
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), true);
});

test("non-eBloček PDF leaves empty payload with failure reason", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: COMPANY_ID, name: "Delta s.r.o.", active: true })
    .run();
  db.insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_01",
      driveFolderId: MONTH_ID,
      closedAt: null,
      openedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
  db.insert(files)
    .values({
      driveFileId: "manual-entry-doc",
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "04 Bločky_hotovosť",
      parentId: SLOT_04_ID,
      name: "train-ticket.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-12T00:00:00.000Z",
      firstSeenAt: "2026-01-12T00:00:00.000Z",
      lastSeenAt: "2026-01-12T00:00:00.000Z",
      deleted: false,
    })
    .run();

  await processCashReceiptFile(
    {
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: "manual-entry-doc",
      folderSlot: "04 Bločky_hotovosť",
      mimeType: "application/pdf",
      fileBytes: new Uint8Array(Buffer.from("fixture")),
    },
    {
      pdfAccess: syntheticPdfAccess(["RegioJet ticket", "Celkem | 14.60 EUR"]),
      qrReader: emptyQrReader(),
      ekasaLookup: failingEkasaLookup(),
      ocr: new FakeOcr(),
      extractor: createStubExtractor(),
      now: () => "2026-01-12T10:00:00.000Z",
    },
  );

  const row = db
    .select()
    .from(documents)
    .where(eq(documents.driveFileId, "manual-entry-doc"))
    .get();
  assert.ok(row);
  assert.equal(row.extractionStatus, "complete");
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(payload.kind, "extracted");
  if (payload.kind === "extracted") {
    assert.equal(payload.source, "model");
  }
});

test("arithmetic mismatch leaves empty payload with failure reason", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: COMPANY_ID, name: "Delta s.r.o.", active: true })
    .run();
  db.insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_01",
      driveFolderId: MONTH_ID,
      closedAt: null,
      openedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
  db.insert(files)
    .values({
      driveFileId: "bad-arithmetic-doc",
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "04 Bločky_hotovosť",
      parentId: SLOT_04_ID,
      name: "bad.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-12T00:00:00.000Z",
      firstSeenAt: "2026-01-12T10:00:00.000Z",
      lastSeenAt: "2026-01-12T10:00:00.000Z",
      deleted: false,
    })
    .run();

  const brokenLines = syntheticEkasaLines();
  const totalIndex = brokenLines.findIndex((line) => line.startsWith("NA ÚHRADU"));
  brokenLines[totalIndex] = "NA ÚHRADU EUR | 99.99";

  await processCashReceiptFile(
    {
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: "bad-arithmetic-doc",
      folderSlot: "04 Bločky_hotovosť",
      mimeType: "application/pdf",
      fileBytes: new Uint8Array(Buffer.from("fixture")),
    },
    {
      pdfAccess: syntheticPdfAccess(brokenLines),
      qrReader: emptyQrReader(),
      ekasaLookup: failingEkasaLookup(),
      ocr: new FakeOcr(),
      extractor: createStubExtractor(),
      now: () => "2026-01-12T10:00:00.000Z",
    },
  );

  const row = db
    .select()
    .from(documents)
    .where(eq(documents.driveFileId, "bad-arithmetic-doc"))
    .get();
  assert.ok(row);
  assert.equal(row.extractionStatus, "failed");
  assert.match(row.extractionFailureReason ?? "", /Item line totals sum/);
  assert.deepEqual(parseExtractedPayload(row.extractedPayloadJson), {});
});

test("fake lookup produces lookup source and stores raw OPD response", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const pdfBytes = new Uint8Array(Buffer.from("fixture-pdf"));
  const uid = "O-11111111111111111111111111111111";
  const lookup = new FakeEkasaLookup({
    responses: {
      [uid]: { ok: true, raw: syntheticEkasaOpdResponse() },
    },
  });
  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: pdfBytes,
  });

  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);

  await discoverCashPaymentsForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess(syntheticEkasaLines()),
    qrReader: emptyQrReader(),
    ekasaLookup: lookup,
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const row = getDb().select().from(documents).get()!;
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), true);
  if (isEkasaPayload(payload)) {
    assert.equal(payload.source, "lookup");
    assert.ok(payload.opdResponse);
  }
  assert.equal(lookup.calls.length, 1);

  const extractedEvents = getDb()
    .select()
    .from(events)
    .where(eq(events.type, "Extracted"))
    .all();
  assert.equal(extractedEvents.length, 1);
  const eventPayload = JSON.parse(extractedEvents[0]!.payloadJson) as {
    source?: string;
  };
  assert.equal(eventPayload.source, "lookup");
});

test("failing fake lookup falls back to text-layer source", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const pdfBytes = new Uint8Array(Buffer.from("fixture-pdf"));
  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: pdfBytes,
  });

  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);

  const lookup = failingEkasaLookup("OPD down");
  await discoverCashPaymentsForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess(syntheticEkasaLines()),
    qrReader: emptyQrReader(),
    ekasaLookup: lookup,
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const row = getDb().select().from(documents).get()!;
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), true);
  if (isEkasaPayload(payload)) {
    assert.equal(payload.source, "text-layer");
    assert.equal(payload.opdResponse, undefined);
  }
});

test("cached OPD response skips a second lookup call", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: COMPANY_ID, name: "Delta s.r.o.", active: true })
    .run();
  db.insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_01",
      driveFolderId: MONTH_ID,
      closedAt: null,
      openedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
  db.insert(files)
    .values({
      driveFileId: RECEIPT_ID,
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "04 Bločky_hotovosť",
      parentId: SLOT_04_ID,
      name: "fixture-blocek.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-12T00:00:00.000Z",
      firstSeenAt: "2026-01-12T00:00:00.000Z",
      lastSeenAt: "2026-01-12T00:00:00.000Z",
      deleted: false,
    })
    .run();

  const opdRaw = syntheticEkasaOpdResponse();
  db.insert(documents)
    .values({
      id: RECEIPT_ID,
      driveFileId: RECEIPT_ID,
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "04 Bločky_hotovosť",
      extractionStatus: "pending",
      extractionFailureReason: null,
      extractedPayloadJson: JSON.stringify({
        kind: "ekasa",
        source: "lookup",
        opdResponse: opdRaw,
      }),
      confirmedPayloadJson: "{}",
      createdAt: "2026-01-12T09:00:00.000Z",
    })
    .run();

  const lookup = new FakeEkasaLookup({
    defaultResult: { ok: false, reason: "should not be called" },
  });

  await processCashReceiptFile(
    {
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: RECEIPT_ID,
      folderSlot: "04 Bločky_hotovosť",
      mimeType: "application/pdf",
      fileBytes: new Uint8Array(Buffer.from("fixture")),
    },
    {
      pdfAccess: syntheticPdfAccess(syntheticEkasaLines()),
      qrReader: emptyQrReader(),
      ekasaLookup: lookup,
      ocr: new FakeOcr(),
      extractor: createStubExtractor(),
      now: () => "2026-01-12T10:00:00.000Z",
    },
  );

  assert.equal(lookup.calls.length, 0);
  const row = db.select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).get()!;
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), true);
  if (isEkasaPayload(payload)) {
    assert.equal(payload.source, "lookup");
  }
});

test("image-only PDF with QR resolves through fake lookup", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const uid = SYNTHETIC_FIXTURE.uid;
  const lookup = new FakeEkasaLookup({
    responses: {
      [uid]: { ok: true, raw: syntheticEkasaOpdResponse() },
    },
  });
  const qrReader = new FakeQrReader([
    ["https://slovnaft.sk/move", uid],
  ]);
  const pageImages: PdfPageImage[] = [
    {
      kind: "rgba",
      data: new Uint8ClampedArray([0, 0, 0, 255]),
      width: 1,
      height: 1,
    },
  ];

  const pdfBytes = new Uint8Array(Buffer.from("scanned-pdf"));
  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: pdfBytes,
  });

  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);

  await discoverCashPaymentsForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess([], pageImages),
    qrReader,
    ekasaLookup: lookup,
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const row = getDb().select().from(documents).get()!;
  assert.equal(row.extractionStatus, "complete");
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), true);
  if (isEkasaPayload(payload)) {
    assert.equal(payload.source, "lookup");
    assert.equal(payload.ekasaUid, uid);
  }
  assert.equal(lookup.calls.length, 1);
  assert.equal(qrReader.calls.length, 1);
});

// A scan attempted before QR decoding existed kept its old failure forever,
// because discovery skipped anything already attempted.
async function seedFailedScan(pipelineVersion: number | null) {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: new Uint8Array(Buffer.from("scanned-pdf")),
  });
  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);
  ensureDocumentsForMonth(1, "2026_01", "2026-01-12T09:00:00.000Z");
  getDb()
    .update(documents)
    .set({
      extractionStatus: "failed",
      extractionFailureReason: "The PDF has no extractable text layer.",
      extractionPipelineVersion: pipelineVersion,
    })
    .where(eq(documents.driveFileId, RECEIPT_ID))
    .run();
  return driveClient;
}

function scanDeps(driveClient: FakeDriveClient) {
  const uid = SYNTHETIC_FIXTURE.uid;
  const lookup = new FakeEkasaLookup({
    responses: { [uid]: { ok: true, raw: syntheticEkasaOpdResponse() } },
  });
  const qrReader = new FakeQrReader([[uid]]);
  const pageImages: PdfPageImage[] = [
    { kind: "rgba", data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 },
  ];
  return {
    lookup,
    qrReader,
    deps: {
      driveClient,
      pdfAccess: syntheticPdfAccess([], pageImages),
      qrReader,
      ekasaLookup: lookup,
      ocr: new FakeOcr(),
      extractor: createStubExtractor(),
      now: () => "2026-01-12T10:00:00.000Z",
    },
  };
}

test("a scan that failed under an older pipeline is read again", async () => {
  const driveClient = await seedFailedScan(null);
  const { lookup, deps } = scanDeps(driveClient);

  await discoverCashPaymentsForMonth(1, "2026_01", deps);

  const row = getDb().select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).get()!;
  assert.equal(row.extractionStatus, "complete");
  assert.equal(row.extractionPipelineVersion, EXTRACTION_PIPELINE_VERSION);
  assert.equal(lookup.calls.length, 1);
});

test("a failure under the current pipeline is not read again", async () => {
  const driveClient = await seedFailedScan(EXTRACTION_PIPELINE_VERSION);
  const { lookup, qrReader, deps } = scanDeps(driveClient);

  await discoverCashPaymentsForMonth(1, "2026_01", deps);

  const row = getDb().select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).get()!;
  assert.equal(row.extractionStatus, "failed");
  assert.equal(qrReader.calls.length, 0);
  assert.equal(lookup.calls.length, 0);
});

test("a photo outside the processed folders is never read", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  const payrollTree = [
    ...fixtureTree.filter((entry) => entry.id !== RECEIPT_ID),
    { id: "payroll-slot", name: "07 Mzdy", parents: [MONTH_ID], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
    { id: "payroll-photo", name: "výplatná páska.jpg", parents: ["payroll-slot"], createdTime: "2026-01-12T00:00:00.000Z", mimeType: "image/jpeg" },
  ];
  const driveClient = new FakeDriveClient(payrollTree, {
    "payroll-photo": new Uint8Array([0xff, 0xd8, 0xff]),
  });
  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);
  const { qrReader, deps } = scanDeps(driveClient);

  await discoverCashPaymentsForMonth(1, "2026_01", deps);

  assert.equal(qrReader.calls.length, 0);
});

test("a document that crashes is recorded, and the rest of the month is still read", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  const BROKEN_ID = "cash-broken-scan";
  const tree = [
    ...fixtureTree,
    { id: BROKEN_ID, name: "a-broken-scan.pdf", parents: [SLOT_04_ID], createdTime: "2026-01-11T00:00:00.000Z", mimeType: "application/pdf" },
  ];
  const driveClient = new FakeDriveClient(tree, {
    [BROKEN_ID]: new Uint8Array(Buffer.from("broken")),
    [RECEIPT_ID]: new Uint8Array(Buffer.from("scanned-pdf")),
  });
  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);
  const { lookup, deps } = scanDeps(driveClient);
  const pageImage: PdfPageImage = { kind: "rgba", data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 };
  deps.pdfAccess = {
    async extractTextLines() {
      return [];
    },
    async extractPageImages(bytes) {
      if (Buffer.from(bytes).toString() === "broken") {
        throw new Error("Cannot transfer object of unsupported type.");
      }
      return [pageImage];
    },
  };

  await discoverCashPaymentsForMonth(1, "2026_01", deps);

  const byId = (id: string) =>
    getDb().select().from(documents).where(eq(documents.driveFileId, id)).get()!;
  assert.equal(byId(BROKEN_ID).extractionStatus, "failed");
  assert.match(byId(BROKEN_ID).extractionFailureReason ?? "", /Reading the document failed/);
  assert.equal(byId(RECEIPT_ID).extractionStatus, "complete");
  assert.equal(lookup.calls.length, 1);
});

function opdResponseFor(uid: string, totalPrice: number): unknown {
  const raw = structuredClone(syntheticEkasaOpdResponse()) as {
    receipt: { receiptId: string; totalPrice: number; items: Array<{ price: number }> };
  };
  raw.receipt.receiptId = uid;
  raw.receipt.totalPrice = totalPrice;
  raw.receipt.items = [{ ...raw.receipt.items[0]!, price: totalPrice }];
  return raw;
}

// Scan 2026-5-10 18.25.50: Stabilit and a Slovnaft fuel receipt side by side.
test("a scan of several receipts becomes one document per receipt", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  const first = SYNTHETIC_FIXTURE.uid;
  const second = "O-22222222222222222222222222222222";
  const third = "V-33333333333333333333333333333333";
  const lookup = new FakeEkasaLookup({
    responses: {
      [first]: { ok: true, raw: syntheticEkasaOpdResponse() },
      [second]: { ok: true, raw: opdResponseFor(second, 18) },
      [third]: { ok: false, reason: "Receipt not found." },
    },
  });
  const qrReader = new FakeQrReader([[first, "https://slovnaft.sk/move", second, third]]);
  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: new Uint8Array(Buffer.from("scanned-pdf")),
  });
  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);
  const { deps } = scanDeps(driveClient);

  await discoverCashPaymentsForMonth(1, "2026_01", { ...deps, qrReader, ekasaLookup: lookup });

  const rows = getDb()
    .select()
    .from(documents)
    .where(eq(documents.driveFileId, RECEIPT_ID))
    .all()
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(
    rows.map((row) => row.id),
    [RECEIPT_ID, `${RECEIPT_ID}#${second}`, `${RECEIPT_ID}#${third}`],
  );
  const own = parseExtractedPayload(rows[0]!.extractedPayloadJson);
  assert.equal(isEkasaPayload(own) && own.ekasaUid, first);
  const secondPayload = parseExtractedPayload(rows[1]!.extractedPayloadJson);
  assert.equal(rows[1]!.extractionStatus, "complete");
  assert.equal(rows[1]!.receiptUid, second);
  assert.equal(isEkasaPayload(secondPayload) && secondPayload.amountCents, 1800);
  // A receipt the lookup does not know is still a document, with its UID kept.
  assert.equal(rows[2]!.extractionStatus, "failed");
  assert.match(rows[2]!.extractionFailureReason ?? "", /not found/);
  assert.match(rows[2]!.extractedPayloadJson, new RegExp(third));
});
