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
import { isEkasaPayload, parseExtractedPayload } from "../../../src/modules/document-payload.ts";

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
      pdfBytes: new Uint8Array(Buffer.from("fixture")),
    },
    {
      pdfAccess: syntheticPdfAccess(["RegioJet ticket", "Celkem | 14.60 EUR"]),
      now: () => "2026-01-12T10:00:00.000Z",
    },
  );

  const row = db
    .select()
    .from(documents)
    .where(eq(documents.driveFileId, "manual-entry-doc"))
    .get();
  assert.ok(row);
  assert.equal(row.extractionStatus, "failed");
  assert.match(row.extractionFailureReason ?? "", /not an eBloček/i);
  assert.deepEqual(parseExtractedPayload(row.extractedPayloadJson), {});
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
      pdfBytes: new Uint8Array(Buffer.from("fixture")),
    },
    {
      pdfAccess: syntheticPdfAccess(brokenLines),
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
