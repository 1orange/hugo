import { sql } from "drizzle-orm";
import { FakeDriveClient } from "@/adapters/drive/fake-drive-client";
import {
  e2eDriveFileContents,
  e2eDriveFixture,
  E2E_DRIVE_PARENT_FOLDER_ID,
} from "@/adapters/drive/e2e-fixture";
import { setDriveParentFolderId } from "@/adapters/store/settings";
import { getDb } from "@/lib/db/migrate";
import {
  companies,
  companyProfiles,
  documents,
  driveMutations,
  events,
  files,
  monthFolders,
  months,
  partners,
  settings,
} from "@/lib/db/schema";
import { runSweep } from "@/lib/sweep/run-sweep";
import {
  ensureDocumentsForMonth,
  upsertEkasaExtractedPayload,
  writeExtractedPayload,
} from "@/adapters/store/documents";
import { emptyExtractedPayload } from "@/modules/document-payload";

/**
 * Puts the e2e database back to the state every spec starts from. The specs
 * share one database and one running server, so without this each spec saw
 * what earlier ones left behind — a company profile already set up, extra
 * documents decided — and four of them failed depending on order.
 */
export async function seedE2eDatabase(): Promise<void> {
  const db = getDb();
  // Children before parents; then restart ids so company 1 is company 1 again.
  for (const table of [
    events,
    driveMutations,
    documents,
    partners,
    companyProfiles,
    files,
    monthFolders,
    months,
    companies,
    settings,
  ]) {
    db.delete(table).run();
  }
  db.run(sql`DELETE FROM sqlite_sequence`);

  const fixture = e2eDriveFixture();
  const fileContents = e2eDriveFileContents();

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

}
