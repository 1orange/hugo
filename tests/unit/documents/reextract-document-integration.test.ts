import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { ensureDocumentsForMonth, getDocument, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { companies, documents, events, files, months } from "../../../src/lib/db/schema.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { requestDocumentReextraction } from "../../../src/lib/documents/reextract-document.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import { freshTestDb } from "../support/test-db.ts";

const INVOICE_ID = "reextract-invoice";

async function seed(): Promise<void> {
  await freshTestDb();
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: "c1", name: "Test", active: true });
  await db.insert(months).values({
    id: 1,
    companyId: 1,
    monthKey: "2026_05",
    driveFolderId: "m1",
    closedAt: null,
    openedAt: "2026-05-01T00:00:00.000Z",
  });
  await db.insert(files).values({
    driveFileId: INVOICE_ID,
    companyId: 1,
    monthKey: "2026_05",
    folderSlot: "02 Prijaté faktúry",
    parentId: "m1",
    name: "invoice.pdf",
    mimeType: "application/pdf",
    driveCreatedTime: "2026-05-10T00:00:00.000Z",
    firstSeenAt: "2026-05-10T00:00:00.000Z",
    lastSeenAt: "2026-05-10T00:00:00.000Z",
    deleted: false,
  });
  await ensureDocumentsForMonth(1, "2026_05", "2026-05-10T00:00:00.000Z");
  // Read once, before a fix reached the app.
  await writeExtractedPayload(INVOICE_ID, {}, "failed", "Extractor returned no parseable JSON content");
}

const request = (scheduled: string[] = []) =>
  requestDocumentReextraction({
    companyId: 1,
    monthKey: "2026_05",
    documentId: INVOICE_ID,
    schedule: async (companyId, monthKey) => {
      scheduled.push(`${companyId}/${monthKey}`);
    },
    now: "2026-05-12T10:00:00.000Z",
  });

const itemOfView = async () =>
  (await buildMonthDocumentView(1, "2026_05"))!.documents.find((document) => document.driveFileId === INVOICE_ID)!;

test("a document is read again on request: pending, queued, recorded", async () => {
  await seed();
  assert.equal((await itemOfView()).canReextract, true);

  const scheduled: string[] = [];
  assert.deepEqual(await request(scheduled), { ok: true });

  const row = (await getDocument(INVOICE_ID))!;
  assert.equal(row.extractionStatus, "pending");
  assert.equal(row.extractionFailureReason, null);
  assert.equal(row.extractionPipelineVersion, null);
  assert.deepEqual(scheduled, ["1/2026_05"]);
  const recorded = await getDb().select().from(events).where(eq(events.type, "ReextractionRequested"));
  assert.equal(recorded.length, 1);
  // Being read, it cannot be asked for again.
  assert.equal((await itemOfView()).canReextract, false);
});

test("a decided, exported or closed document is not read again", async () => {
  await seed();
  const db = getDb();

  await db.update(documents).set({ decision: "confirmed" }).where(eq(documents.id, INVOICE_ID));
  assert.equal((await request()).ok, false);
  assert.equal((await itemOfView()).canReextract, false);

  await db.update(documents).set({ decision: null, exportedAt: "2026-06-01T00:00:00.000Z" }).where(eq(documents.id, INVOICE_ID));
  assert.equal((await request()).ok, false);

  await db.update(documents).set({ exportedAt: null }).where(eq(documents.id, INVOICE_ID));
  await db.update(months).set({ closedAt: "2026-06-02T00:00:00.000Z" }).where(eq(months.id, 1));
  assert.equal((await request()).ok, false);
  assert.equal((await getDocument(INVOICE_ID))!.extractionStatus, "failed");
});
