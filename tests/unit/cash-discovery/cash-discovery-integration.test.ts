import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { createPdfAccess } from "../../../src/adapters/pdf/pdf-access.ts";
import { createZxingQrDecoder } from "../../../src/adapters/pdf/zxing-qr-decoder.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { payments, receiptManualQueue, months, companies, files } from "../../../src/lib/db/schema.ts";
import { eq } from "drizzle-orm";
import {
  discoverCashPaymentsForMonth,
  processCashReceiptFile,
} from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import { createSyntheticEkasaQrImage } from "./synthetic-ekasa-pdf.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";

const PARENT_ID = "cash-parent";
const COMPANY_ID = "cash-company";
const MONTH_ID = "cash-month";
const SLOT_04_ID = "cash-slot-04";
const RECEIPT_ID = "cash-receipt-doc";

const FIXTURE_OKP = "C44B3977-0E415CC6-EE663AA1-776C973A-A143B660";
const FIXTURE_REGISTER = "99920045678900001";
const FIXTURE_TIMESTAMP = "260128120000";
const FIXTURE_SEQUENCE = "1";
const FIXTURE_AMOUNT = "123.45";
const FIXTURE_PAYLOAD = [
  FIXTURE_OKP,
  FIXTURE_REGISTER,
  FIXTURE_TIMESTAMP,
  FIXTURE_SEQUENCE,
  FIXTURE_AMOUNT,
].join(":");

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

test("fixture eBloček produces exactly one cash payment with expected amount and timestamp", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const pdfBytes = new Uint8Array(Buffer.from("fixture-pdf"));
  const qrImage = await createSyntheticEkasaQrImage(FIXTURE_PAYLOAD);
  const pdfAccess: PdfAccess = {
    async extractEmbeddedImages() {
      return [];
    },
    async renderPage() {
      return qrImage;
    },
  };
  const driveClient = new FakeDriveClient(fixtureTree, {
    [RECEIPT_ID]: pdfBytes,
  });

  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);

  const deps = {
    driveClient,
    pdfAccess,
    qrDecoder: createZxingQrDecoder(),
    now: () => "2026-01-12T10:00:00.000Z",
  };

  await discoverCashPaymentsForMonth(1, "2026_01", deps);
  await discoverCashPaymentsForMonth(1, "2026_01", deps);

  const db = getDb();
  const paymentRows = db.select().from(payments).all();
  assert.equal(paymentRows.length, 1);
  assert.equal(paymentRows[0]?.source, "cash");
  assert.equal(paymentRows[0]?.blocekFileId, RECEIPT_ID);
  assert.equal(paymentRows[0]?.amountLiteral, FIXTURE_AMOUNT);
  assert.equal(paymentRows[0]?.amountCents, 12345);
  assert.equal(paymentRows[0]?.receiptTimestampRaw, FIXTURE_TIMESTAMP);
  assert.equal(paymentRows[0]?.receiptAt, "2026-01-28T11:00:00.000Z");
});

test("receipt without readable QR is queued for manual entry", async () => {
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
      name: "broken.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-12T00:00:00.000Z",
      firstSeenAt: "2026-01-12T00:00:00.000Z",
      lastSeenAt: "2026-01-12T00:00:00.000Z",
      deleted: false,
    })
    .run();

  const pdfBytes = new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"));
  await processCashReceiptFile(
    {
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: "manual-queue-doc",
      pdfBytes,
    },
    {
      pdfAccess: createPdfAccess(),
      qrDecoder: {
        async decodeFromImage() {
          return null;
        },
      },
      now: () => "2026-01-12T10:00:00.000Z",
    },
  );

  const queueRow = db
    .select()
    .from(receiptManualQueue)
    .where(eq(receiptManualQueue.driveFileId, "manual-queue-doc"))
    .get();
  assert.ok(queueRow);
  assert.match(queueRow.reason, /QR|PDF/i);
  assert.equal(db.select().from(payments).all().length, 0);
});
