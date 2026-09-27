import fs from "node:fs";
import path from "node:path";
import { isNull, sql } from "drizzle-orm";
import { FakeDriveClient } from "../src/adapters/drive/fake-drive-client.ts";
import {
  e2eDriveFixture,
  E2E_DRIVE_PARENT_FOLDER_ID,
} from "../src/adapters/drive/e2e-fixture.ts";
import { setDriveParentFolderId } from "../src/adapters/store/settings.ts";
import { runMigrations, resetDbForTests, getDb } from "../src/lib/db/migrate.ts";
import { documents } from "../src/lib/db/schema.ts";
import { runSweep } from "../src/lib/sweep/run-sweep.ts";
import {
  ensureDocumentsForMonth,
  upsertEkasaExtractedPayload,
  writeExtractedPayload,
} from "../src/adapters/store/documents.ts";
import { emptyExtractedPayload } from "../src/modules/document-payload.ts";

async function main(): Promise<void> {
  const dbPath = path.resolve(process.cwd(), "data", "e2e.db");

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const fixture = e2eDriveFixture();
  const fileContents: Record<string, Uint8Array> = {
    "e2e-doc-supplier": new Uint8Array(Buffer.from("%PDF-1.4 supplier")),
    "e2e-doc-receipt": new Uint8Array(Buffer.from("%PDF-1.4 receipt")),
    "e2e-doc-blank-receipt": new Uint8Array(Buffer.from("%PDF-1.4 blank")),
    "e2e-doc-cz-receipt": new Uint8Array(Buffer.from("%PDF-1.4 cz receipt")),
    "e2e-doc-vat": new Uint8Array(Buffer.from("%PDF-1.4 vat")),
    "e2e-doc-photo-jpeg": new Uint8Array(Buffer.from("jpeg-bytes")),
    "e2e-doc-photo-heic": new Uint8Array(Buffer.from("heic-bytes")),
  };

  const driveClient = new FakeDriveClient(fixture, fileContents);
  setDriveParentFolderId(E2E_DRIVE_PARENT_FOLDER_ID);

  await runSweep(driveClient);
  const now = "2026-01-12T10:00:00.000Z";
  ensureDocumentsForMonth(1, "2026_01", now);
  ensureDocumentsForMonth(2, "2026_01", now);

  writeExtractedPayload(
    "e2e-doc-blank-receipt",
    emptyExtractedPayload(),
    "failed",
    "The PDF has no extractable text layer.",
  );

  upsertEkasaExtractedPayload({
    driveFileId: "e2e-doc-receipt",
    companyId: 1,
    monthKey: "2026_01",
    folderSlot: "04 Bločky_hotovosť",
    payload: {
      kind: "ekasa",
      amountCents: 1550,
      amountLiteral: "15.50",
      currency: "EUR",
      receiptAt: "2026-01-11T12:00:00.000Z",
      receiptTimestampRaw: "2026-01-11 13:00:00",
      ekasaUid: "uid",
      ekasaOkp: "okp",
      supplierName: "Test Shop",
      dic: null,
      ico: null,
      icDph: null,
      kp: null,
      receiptNumber: null,
      recapBaseCents: null,
      recapBaseLiteral: null,
      recapVatCents: null,
      recapVatLiteral: null,
      lineItems: [],
      vatRecap: [],
    },
    extractionStatus: "complete",
    extractionFailureReason: null,
    createdAt: now,
  });

  upsertEkasaExtractedPayload({
    driveFileId: "e2e-doc-cz-receipt",
    companyId: 2,
    monthKey: "2026_01",
    folderSlot: "04 Bločky_hotovosť",
    payload: {
      kind: "ekasa",
      amountCents: 39900,
      amountLiteral: "399.00",
      currency: "CZK",
      receiptAt: "2026-01-11T12:00:00.000Z",
      receiptTimestampRaw: "2026-01-11 13:00:00",
      ekasaUid: "uid-cz",
      ekasaOkp: "okp-cz",
      supplierName: "CZ Test Shop",
      dic: null,
      ico: null,
      icDph: null,
      kp: null,
      receiptNumber: null,
      recapBaseCents: null,
      recapBaseLiteral: null,
      recapVatCents: null,
      recapVatLiteral: null,
      lineItems: [],
      vatRecap: [],
    },
    extractionStatus: "complete",
    extractionFailureReason: null,
    createdAt: now,
  });

  const db = getDb();
  const awaiting = db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(isNull(documents.decision))
    .get();
  console.log(
    "E2E document seed complete:",
    dbPath,
    `(${awaiting?.count ?? 0} documents awaiting decision)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
