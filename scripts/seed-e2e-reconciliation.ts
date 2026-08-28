import fs from "node:fs";
import path from "node:path";
import { FakeDriveClient } from "../src/adapters/drive/fake-drive-client.ts";
import {
  e2eDriveFixture,
  E2E_DRIVE_PARENT_FOLDER_ID,
} from "../src/adapters/drive/e2e-fixture.ts";
import { setDriveParentFolderId } from "../src/adapters/store/settings.ts";
import { runMigrations, resetDbForTests, getDb } from "../src/lib/db/migrate.ts";
import { runSweep } from "../src/lib/sweep/run-sweep.ts";
import { ensureProofsForMonth } from "../src/adapters/store/proofs.ts";
import { payments } from "../src/lib/db/schema.ts";

import { pairPaymentWithProof } from "../src/lib/reconciliation/service.ts";

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
    "e2e-doc-vat": new Uint8Array(Buffer.from("%PDF-1.4 vat")),
    "e2e-doc-photo-jpeg": new Uint8Array(Buffer.from("jpeg-bytes")),
    "e2e-doc-photo-heic": new Uint8Array(Buffer.from("heic-bytes")),
  };

  const driveClient = new FakeDriveClient(fixture, fileContents);
  setDriveParentFolderId(E2E_DRIVE_PARENT_FOLDER_ID);

  await runSweep(driveClient);
  ensureProofsForMonth(1, "2026_01", "2026-01-12T10:00:00.000Z");

  const db = getDb();
  db.insert(payments)
    .values([
      {
        companyId: 1,
        monthKey: "2026_01",
        source: "bank",
        blocekFileId: null,
        amountCents: 4200,
        amountLiteral: "42.00",
        currency: "EUR",
        receiptAt: "2026-01-09T10:00:00.000Z",
        decodeStatus: "complete",
        createdAt: "2026-01-09T10:00:00.000Z",
      },
      {
        companyId: 1,
        monthKey: "2026_01",
        source: "cash",
        blocekFileId: "e2e-doc-receipt",
        amountCents: 1550,
        amountLiteral: "15.50",
        currency: "EUR",
        receiptAt: "2026-01-11T12:00:00.000Z",
        decodeStatus: "complete",
        createdAt: "2026-01-11T12:00:00.000Z",
      },
    ])
    .run();

  pairPaymentWithProof({
    companyId: 1,
    monthKey: "2026_01",
    paymentId: 1,
    proofDriveFileId: "e2e-doc-supplier",
    now: "2026-01-12T11:00:00.000Z",
  });

  console.log("E2E reconciliation seed complete:", dbPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
