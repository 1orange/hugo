import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import {
  paymentLineItems,
  payments,
  receiptManualQueue,
  months,
  companies,
  files,
} from "../../../src/lib/db/schema.ts";
import { eq } from "drizzle-orm";
import {
  discoverCashPaymentsForMonth,
  processCashReceiptFile,
} from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import {
  syntheticEkasaLines,
  SYNTHETIC_FIXTURE,
} from "./synthetic-ekasa-lines.ts";

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

function syntheticPdfAccess(lines: string[]): PdfAccess {
  return {
    async extractTextLines() {
      return lines;
    },
  };
}

test("fixture eBloček produces exactly one cash payment with expected amount and timestamp", async () => {
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
    now: () => "2026-01-12T10:00:00.000Z",
  };

  await discoverCashPaymentsForMonth(1, "2026_01", deps);
  await discoverCashPaymentsForMonth(1, "2026_01", deps);

  const db = getDb();
  const paymentRows = db.select().from(payments).all();
  assert.equal(paymentRows.length, 1);
  assert.equal(paymentRows[0]?.source, "cash");
  assert.equal(paymentRows[0]?.blocekFileId, RECEIPT_ID);
  assert.equal(paymentRows[0]?.amountLiteral, SYNTHETIC_FIXTURE.totalLiteral);
  assert.equal(paymentRows[0]?.amountCents, SYNTHETIC_FIXTURE.totalCents);
  assert.equal(paymentRows[0]?.receiptTimestampRaw, SYNTHETIC_FIXTURE.timestampRaw);
  assert.equal(paymentRows[0]?.receiptAt, SYNTHETIC_FIXTURE.receiptAtUtc);
  assert.equal(paymentRows[0]?.ekasaUid, SYNTHETIC_FIXTURE.uid);
  assert.equal(paymentRows[0]?.ekasaOkp, SYNTHETIC_FIXTURE.okp);
  assert.equal(paymentRows[0]?.decodeStatus, "complete");

  const lineItems = db
    .select()
    .from(paymentLineItems)
    .where(eq(paymentLineItems.paymentId, paymentRows[0]!.id))
    .all();
  assert.equal(lineItems.length, 2);
});

test("non-eBloček PDF is queued for manual entry", async () => {
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
      driveFileId: "manual-queue-doc",
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
      driveFileId: "manual-queue-doc",
      pdfBytes: new Uint8Array(Buffer.from("fixture")),
    },
    {
      pdfAccess: syntheticPdfAccess(["RegioJet ticket", "Celkem | 14.60 EUR"]),
      now: () => "2026-01-12T10:00:00.000Z",
    },
  );

  const queueRow = db
    .select()
    .from(receiptManualQueue)
    .where(eq(receiptManualQueue.driveFileId, "manual-queue-doc"))
    .get();
  assert.ok(queueRow);
  assert.match(queueRow.reason, /not an eBloček/i);
  assert.equal(db.select().from(payments).all().length, 0);
});

test("arithmetic mismatch is queued without creating a payment", async () => {
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
      pdfBytes: new Uint8Array(Buffer.from("fixture")),
    },
    {
      pdfAccess: syntheticPdfAccess(brokenLines),
      now: () => "2026-01-12T10:00:00.000Z",
    },
  );

  const queueRow = db
    .select()
    .from(receiptManualQueue)
    .where(eq(receiptManualQueue.driveFileId, "bad-arithmetic-doc"))
    .get();
  assert.ok(queueRow);
  assert.match(queueRow.reason, /Item line totals sum/);
  assert.equal(db.select().from(payments).all().length, 0);
});
