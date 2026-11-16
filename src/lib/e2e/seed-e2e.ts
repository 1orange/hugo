import { sql } from "drizzle-orm";
import { resetE2eFakeDrive } from "@/adapters/drive/create-drive-client";
import { E2E_CLOSED_MONTH, E2E_DRIVE_PARENT_FOLDER_ID } from "@/adapters/drive/e2e-fixture";
import { closeMonth } from "@/adapters/store/months";
import { syncLateArrivals } from "@/lib/late-arrivals/sync";
import { setDriveParentFolderId } from "@/adapters/store/settings";
import { getDb } from "@/lib/db/client";
import {
  companies,
  companyProfiles,
  documents,
  driveMutations,
  events,
  files,
  lateArrivals,
  driveItems,
  monthFolders,
  months,
  partners,
  settings,
  structureDeviations,
  subjectAliasSightings,
  subjectAliases,
  subjects,
} from "@/lib/db/schema";
import { runSweep } from "@/lib/sweep/run-sweep";
import {
  ensureDocumentsForMonth,
  upsertEkasaExtractedPayload,
  writeExtractedPayload,
} from "@/adapters/store/documents";
import { emptyExtractedPayload } from "@/modules/document-payload";
import { insertSubject } from "@/adapters/store/subjects";
import { extractionModelQueue, extractionQueue, subjectQueue } from "@/adapters/job-queue/bullmq-queues";
import { redis, redisKey, redisUrl } from "@/lib/redis/connection";

/** What an earlier spec left queued, and how its reads ended, goes too. */
async function clearE2eQueues(): Promise<void> {
  if (!redisUrl()) {
    return;
  }
  await extractionQueue().obliterate({ force: true });
  await extractionModelQueue().obliterate({ force: true });
  await subjectQueue().obliterate({ force: true });
  await redis().del(redisKey("extraction", "recent"));
}

/**
 * Puts the e2e database back to the state every spec starts from. The specs
 * share one database and one running server, so without this each spec saw
 * what earlier ones left behind — a company profile already set up, extra
 * documents decided — and four of them failed depending on order.
 */
export async function seedE2eDatabase(): Promise<void> {
  const db = getDb();
  // Every table, then ids from 1 again so company 1 is company 1 again.
  await db.execute(sql`TRUNCATE TABLE ${sql.join(
    [
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
      structureDeviations,
      lateArrivals,
      driveItems,
      subjectAliasSightings,
      subjectAliases,
      subjects,
    ],
    sql`, `,
  )} RESTART IDENTITY CASCADE`);
  await clearE2eQueues();

  // The server's own fake Drive, afresh: what a spec moved in it is undone.
  const driveClient = resetE2eFakeDrive();
  await setDriveParentFolderId(E2E_DRIVE_PARENT_FOLDER_ID);

  // Gamma's December closed before its files were first seen: they are late arrivals.
  await runSweep(driveClient);
  await closeMonth(E2E_CLOSED_MONTH.companyId, E2E_CLOSED_MONTH.monthKey, E2E_CLOSED_MONTH.closedAt);
  await syncLateArrivals(new Date().toISOString(), E2E_CLOSED_MONTH.companyId);
  const now = "2026-01-12T10:00:00.000Z";
  await ensureDocumentsForMonth(1, "2026_01", now);
  await ensureDocumentsForMonth(2, "2026_01", now);

  await writeExtractedPayload(
    "e2e-doc-blank-receipt",
    emptyExtractedPayload(),
    "failed",
    "The PDF has no extractable text layer.",
  );

  await upsertEkasaExtractedPayload({
    driveFileId: "e2e-doc-receipt",
    companyId: 1,
    monthKey: "2026_01",
    folderSlot: "04 Bločky",
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

  await upsertEkasaExtractedPayload({
    driveFileId: "e2e-doc-cz-receipt",
    companyId: 2,
    monthKey: "2026_01",
    folderSlot: "04 Bločky",
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

  // One subject in the shared directory, for the *Adresár* spec: a counterparty verified earlier.
  await insertSubject({
    country: "SK",
    ico: "35757442",
    vatId: "SK2020357574",
    legalName: "Gamma Trade, s.r.o.",
    formerNames: ["Gamma s.r.o."],
    dic: "2020357574",
    address: "Košice, Hlavná 12",
    registerStatus: "active",
    sources: { legalName: "register", dic: "register", address: "register" },
    verifiedAt: now,
    now,
  });
}
