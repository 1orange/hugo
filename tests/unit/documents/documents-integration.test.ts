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
  events,
  files,
  months,
} from "../../../src/lib/db/schema.ts";
import { ensureDocumentsForMonth } from "../../../src/adapters/store/documents.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import {
  confirmDocument,
  dismissDocument,
  saveDocumentFields,
  saveDocumentNote,
} from "../../../src/lib/documents/service.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import { countAwaitingDecision } from "../../../src/adapters/store/documents.ts";
import { discoverCashPaymentsForMonth } from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import { failingEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import {
  syntheticEkasaLines,
  SYNTHETIC_FIXTURE,
} from "../cash-discovery/synthetic-ekasa-lines.ts";
import {
  emptyExtractedPayload,
  isEkasaPayload,
  parseConfirmedPayload,
  parseExtractedPayload,
  serializeExtractedPayload,
} from "../../../src/modules/document-payload.ts";
import { mergeDocumentFields } from "../../../src/modules/document-fields.ts";

const PARENT_ID = "doc-parent";
const COMPANY_DRIVE_ID = "doc-company";
const MONTH_ID = "doc-month";
const SLOT_02_ID = "doc-slot-02";
const SLOT_04_ID = "doc-slot-04";
const SLOT_06_ID = "doc-slot-06";
const RECEIPT_ID = "doc-receipt";
const INVOICE_A = "doc-invoice-a";
const INVOICE_B = "doc-invoice-b";

function emptyFieldInput(
  partial: Partial<import("../../../src/modules/document-fields.ts").DocumentFieldFormInput> = {},
) {
  return {
    exportSection: "",
    supplierName: "",
    ico: "",
    dic: "",
    icDph: "",
    customerName: "",
    customerIco: "",
    customerDic: "",
    customerIcDph: "",
    documentNumber: "",
    variableSymbol: "",
    issueDateRaw: "",
    taxableSupplyDateRaw: "",
    dueDateRaw: "",
    receiptNumber: "",
    receiptTimestampRaw: "",
    currency: "EUR",
    amountLiteral: "",
    recapBaseLiteral: "",
    recapVatLiteral: "",
    vatRecap: [] as Array<{ rateLiteral: string; baseLiteral: string; vatLiteral: string }>,
    ...partial,
  };
}

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-doc-")),
    "test.db",
  );
}

function syntheticPdfAccess(lines: string[]): PdfAccess {
  return {
    async extractTextLines() {
      return lines;
    },
    async extractPageImages() {
      return [];
    },
  };
}

function seedMonth(dbPath: string): void {
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: COMPANY_DRIVE_ID, name: "Delta s.r.o.", active: true })
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
    .values([
      {
        driveFileId: INVOICE_A,
        companyId: 1,
        monthKey: "2026_01",
        folderSlot: "02 Prijaté faktúry",
        parentId: SLOT_02_ID,
        name: "invoice-a.pdf",
        mimeType: "application/pdf",
        driveCreatedTime: "2026-01-10T00:00:00.000Z",
        firstSeenAt: "2026-01-10T00:00:00.000Z",
        lastSeenAt: "2026-01-10T00:00:00.000Z",
        deleted: false,
      },
      {
        driveFileId: INVOICE_B,
        companyId: 1,
        monthKey: "2026_01",
        folderSlot: "02 Prijaté faktúry",
        parentId: SLOT_02_ID,
        name: "invoice-b.pdf",
        mimeType: "application/pdf",
        driveCreatedTime: "2026-01-11T00:00:00.000Z",
        firstSeenAt: "2026-01-11T00:00:00.000Z",
        lastSeenAt: "2026-01-11T00:00:00.000Z",
        deleted: false,
      },
      {
        driveFileId: RECEIPT_ID,
        companyId: 1,
        monthKey: "2026_01",
        folderSlot: "04 Bločky_hotovosť",
        parentId: SLOT_04_ID,
        name: "cash.pdf",
        mimeType: "application/pdf",
        driveCreatedTime: "2026-01-12T00:00:00.000Z",
        firstSeenAt: "2026-01-12T00:00:00.000Z",
        lastSeenAt: "2026-01-12T00:00:00.000Z",
        deleted: false,
      },
      {
        driveFileId: "statement-only",
        companyId: 1,
        monthKey: "2026_01",
        folderSlot: "03 Bankové výpisy",
        parentId: "slot-03",
        name: "statement.pdf",
        mimeType: "application/pdf",
        driveCreatedTime: "2026-01-12T00:00:00.000Z",
        firstSeenAt: "2026-01-12T00:00:00.000Z",
        lastSeenAt: "2026-01-12T00:00:00.000Z",
        deleted: false,
      },
    ])
    .run();

  ensureDocumentsForMonth(1, "2026_01", "2026-01-12T10:00:00.000Z");
}

test("ensureDocumentsForMonth creates rows only for processed folders", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const db = getDb();
  const rows = db.select().from(documents).all();
  assert.equal(rows.length, 3);
  assert.equal(rows.some((row) => row.driveFileId === "statement-only"), false);
});

test("discovery creates ekasa payload without touching confirmed payload", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const fixtureTree = [
    {
      id: PARENT_ID,
      name: "Clients",
      parents: [] as string[],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: COMPANY_DRIVE_ID,
      name: "Delta s.r.o.",
      parents: [PARENT_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: MONTH_ID,
      name: "2026_01",
      parents: [COMPANY_DRIVE_ID],
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

  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: new Uint8Array(Buffer.from("fixture-pdf")),
  });

  const { setDriveParentFolderId } = await import(
    "../../../src/adapters/store/settings.ts"
  );
  const { runSweep } = await import("../../../src/lib/sweep/run-sweep.ts");
  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);
  ensureDocumentsForMonth(1, "2026_01", "2026-01-12T10:00:00.000Z");

  const db = getDb();
  db.update(documents)
    .set({ confirmedPayloadJson: JSON.stringify({ amountLiteral: "manual" }) })
    .where(eq(documents.driveFileId, RECEIPT_ID))
    .run();

  await discoverCashPaymentsForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess(syntheticEkasaLines()),
    qrReader: emptyQrReader(),
    ekasaLookup: failingEkasaLookup(),
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const row = db.select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).get()!;
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), true);
  if (isEkasaPayload(payload)) {
    assert.equal(payload.amountLiteral, SYNTHETIC_FIXTURE.totalLiteral);
    assert.equal(payload.amountCents, SYNTHETIC_FIXTURE.totalCents);
  }
  assert.equal(row.confirmedPayloadJson, JSON.stringify({ amountLiteral: "manual" }));
});

test("two confirmed and one dismissed drives awaiting count to zero", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const now = "2026-01-13T12:00:00.000Z";

  assert.equal(countAwaitingDecision(1, "2026_01"), 3);

  assert.equal(
    confirmDocument({
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: INVOICE_A,
      confirmed: true,
      now,
    }).ok,
    true,
  );
  assert.equal(
    confirmDocument({
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: RECEIPT_ID,
      confirmed: true,
      now,
    }).ok,
    true,
  );
  assert.equal(
    dismissDocument({
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: INVOICE_B,
      reason: "proforma",
      now,
    }).ok,
    true,
  );

  assert.equal(countAwaitingDecision(1, "2026_01"), 0);
});

test("confirming emits Confirmed with driveFileId", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const now = "2026-01-13T12:00:00.000Z";

  confirmDocument({
    companyId: 1,
    monthKey: "2026_01",
    driveFileId: RECEIPT_ID,
    confirmed: true,
    now,
  });

  const db = getDb();
  const event = db.select().from(events).where(eq(events.type, "Confirmed")).get();
  assert.ok(event);
  const payload = JSON.parse(event.payloadJson) as { driveFileId?: string };
  assert.equal(payload.driveFileId, RECEIPT_ID);
});

test("notes persist on documents", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);

  assert.equal(
    saveDocumentNote({
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: INVOICE_A,
      note: "  waiting for supplier reply  ",
    }).ok,
    true,
  );

  const view = buildMonthDocumentView(1, "2026_01")!;
  assert.equal(
    view.documents.find((document) => document.driveFileId === INVOICE_A)?.note,
    "waiting for supplier reply",
  );
});

test("closed month rejects confirming and dismissing", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const db = getDb();
  db.update(months)
    .set({ closedAt: "2026-01-31T00:00:00.000Z" })
    .where(eq(months.id, 1))
    .run();

  assert.equal(
    confirmDocument({
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: INVOICE_A,
      confirmed: true,
    }).ok,
    false,
  );
  assert.equal(
    dismissDocument({
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: INVOICE_B,
    }).ok,
    false,
  );
});

test("moving folder slot on file updates derived receipt kind in the view", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const db = getDb();

  db.update(files)
    .set({ folderSlot: "05 Bločky_firemná karta" })
    .where(eq(files.driveFileId, RECEIPT_ID))
    .run();
  ensureDocumentsForMonth(1, "2026_01", "2026-01-13T10:00:00.000Z");

  const view = buildMonthDocumentView(1, "2026_01")!;
  const receipt = view.documents.find((document) => document.driveFileId === RECEIPT_ID);
  assert.equal(receipt?.receiptKind, "card");
});

test("saveDocumentFields writes confirmed payload only", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);

  assert.equal(
    saveDocumentFields({
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: RECEIPT_ID,
      fields: emptyFieldInput({
        supplierName: "Manual Shop",
        ico: "99999999",
        receiptNumber: "77",
        documentNumber: "77",
        receiptTimestampRaw: "16.04.2026 14:05:59",
        amountLiteral: "20.00",
        recapBaseLiteral: "16.26",
        recapVatLiteral: "3.74",
        vatRecap: [{ rateLiteral: "23.0", baseLiteral: "16.26", vatLiteral: "3.74" }],
      }),
    }).ok,
    true,
  );

  const db = getDb();
  const row = db.select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).get()!;
  const confirmed = parseConfirmedPayload(row.confirmedPayloadJson);
  assert.equal(confirmed.supplierName, "Manual Shop");
  assert.equal(confirmed.amountLiteral, "20.00");
  assert.equal(confirmed.amountCents, 2000);
  assert.equal(row.extractedPayloadJson, serializeExtractedPayload(emptyExtractedPayload()));
});

test("confirmed field values survive re-extraction", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const fixtureTree = [
    {
      id: PARENT_ID,
      name: "Clients",
      parents: [] as string[],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: COMPANY_DRIVE_ID,
      name: "Delta s.r.o.",
      parents: [PARENT_ID],
      createdTime: "2026-01-01T00:00:00.000Z",
      mimeType: FOLDER_MIME,
    },
    {
      id: MONTH_ID,
      name: "2026_01",
      parents: [COMPANY_DRIVE_ID],
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

  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: new Uint8Array(Buffer.from("fixture-pdf")),
  });

  const { setDriveParentFolderId } = await import(
    "../../../src/adapters/store/settings.ts"
  );
  const { runSweep } = await import("../../../src/lib/sweep/run-sweep.ts");
  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);
  ensureDocumentsForMonth(1, "2026_01", "2026-01-12T10:00:00.000Z");

  saveDocumentFields({
    companyId: 1,
    monthKey: "2026_01",
    driveFileId: RECEIPT_ID,
    fields: emptyFieldInput({
      supplierName: "Her corrected name",
      amountLiteral: "99.99",
    }),
  });

  await discoverCashPaymentsForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess(syntheticEkasaLines()),
    qrReader: emptyQrReader(),
    ekasaLookup: failingEkasaLookup(),
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const db = getDb();
  const row = db.select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).get()!;
  const extracted = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(extracted), true);
  if (isEkasaPayload(extracted)) {
    assert.equal(extracted.amountLiteral, SYNTHETIC_FIXTURE.totalLiteral);
  }

  const merged = mergeDocumentFields(extracted, parseConfirmedPayload(row.confirmedPayloadJson));
  assert.equal(merged.fields.supplierName, "Her corrected name");
  assert.equal(merged.fields.amountLiteral, "99.99");
  assert.equal(merged.provenance.supplierName, "confirmed");
});

test("arithmetic mismatch does not block saving fields", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);

  const result = saveDocumentFields({
    companyId: 1,
    monthKey: "2026_01",
    driveFileId: RECEIPT_ID,
    fields: emptyFieldInput({
      supplierName: "Shop",
      amountLiteral: "16.85",
      recapBaseLiteral: "13.70",
      recapVatLiteral: "3.00",
    }),
  });
  assert.equal(result.ok, true);

  const db = getDb();
  const row = db.select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).get()!;
  const confirmed = parseConfirmedPayload(row.confirmedPayloadJson);
  assert.equal(confirmed.recapVatLiteral, "3.00");
});

test("company profile saved after extraction assigns party roles without re-extraction", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const db = getDb();

  const modelPayload = {
    kind: "extracted" as const,
    parties: [
      { name: "Dodávateľ s.r.o.", ico: "87654321", dic: null, icDph: "SK8765432100" },
      { name: "Beta s.r.o.", ico: "31333532", dic: null, icDph: "SK7120001713" },
    ],
    documentNumber: "2026001",
    variableSymbol: "2026001",
    issueDate: "2026-01-10",
    taxableSupplyDate: "2026-01-10",
    dueDate: "2026-01-20",
    currency: "EUR",
    amountCents: 10000,
    amountLiteral: "100.00",
    vatRecap: [],
    docTypeHint: "invoice" as const,
  };

  db.update(documents)
    .set({
      extractedPayloadJson: serializeExtractedPayload(modelPayload),
      extractionStatus: "complete",
    })
    .where(eq(documents.driveFileId, INVOICE_A))
    .run();

  let view = buildMonthDocumentView(1, "2026_01")!;
  let invoice = view.documents.find((document) => document.driveFileId === INVOICE_A)!;
  assert.equal(invoice.fieldEditor.missingProfile, true);
  assert.equal(invoice.fieldEditor.rolesFlagged, true);

  saveCompanyProfile(1, {
    country: "SK",
    legalName: "Delta s.r.o.",
    address: "Bratislava",
    ico: "31333532",
    dic: "2020311335",
    icDph: "SK7120001713",
    registerSource: "fake",
    savedAt: "2026-01-12T10:00:00.000Z",
  });

  view = buildMonthDocumentView(1, "2026_01")!;
  invoice = view.documents.find((document) => document.driveFileId === INVOICE_A)!;
  assert.equal(invoice.fieldEditor.fields.customerName, "Beta s.r.o.");
  assert.equal(invoice.fieldEditor.fields.supplierName, "Dodávateľ s.r.o.");
  assert.equal(invoice.fieldEditor.rolesFlagged, false);
});

test("closed month rejects saving fields", () => {
  const dbPath = tempDbPath();
  seedMonth(dbPath);
  const db = getDb();
  db.update(months)
    .set({ closedAt: "2026-01-31T00:00:00.000Z" })
    .where(eq(months.id, 1))
    .run();

  assert.equal(
    saveDocumentFields({
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: RECEIPT_ID,
      fields: emptyFieldInput({
        supplierName: "Shop",
        amountLiteral: "1.00",
      }),
    }).ok,
    false,
  );
});
