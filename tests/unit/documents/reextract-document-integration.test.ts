import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  ensureDocumentsForMonth,
  finalizeReextraction,
  beginExtractionAttempt,
  getDocument,
  markForReextraction,
  upsertEkasaExtractedPayload,
  writeConfirmedPayload,
  writeExtractedPayload,
} from "../../../src/adapters/store/documents.ts";
import { companies, documents, events, files, months } from "../../../src/lib/db/schema.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { requestDocumentReextraction } from "../../../src/lib/documents/reextract-document.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import { parseExtractedPayload } from "../../../src/modules/document-payload.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
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

function extractedDocumentNumber(json: string): string | null {
  const payload = parseExtractedPayload(json);
  if (payload.kind !== "extracted") {
    throw new Error(`expected a model payload, got ${payload.kind ?? "empty"}`);
  }
  return payload.documentNumber;
}

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

test("manual replacement keeps active fields visible until atomic promotion", async () => {
  await seed();
  const oldPayload = {
    kind: "extracted" as const,
    parties: [{ name: "Staré meno", ico: null, dic: null, icDph: null }],
    documentNumber: "OLD",
    variableSymbol: null,
    issueDate: null,
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 100,
    amountLiteral: "1.00",
    vatRecap: [],
    docTypeHint: "invoice" as const,
  };
  const newPayload = { ...oldPayload, documentNumber: "NEW", parties: [] };
  await writeExtractedPayload(INVOICE_ID, oldPayload, "complete", null);
  const db = getDb();
  await db.update(documents).set({ extractionPipelineVersion: 2 }).where(eq(documents.id, INVOICE_ID));
  await writeConfirmedPayload(INVOICE_ID, { supplierName: "Ručná oprava", amountCents: 999 });
  await db.update(documents).set({ note: "Nezabudnúť" }).where(eq(documents.id, INVOICE_ID));

  await markForReextraction(INVOICE_ID);
  await beginExtractionAttempt(INVOICE_ID);
  const during = (await getDocument(INVOICE_ID))!;
  assert.equal(during.extractionStatus, "pending");
  assert.equal(during.extractionPipelineVersion, 2);
  assert.equal(parseExtractedPayload(during.extractedPayloadJson).kind, "extracted");
  assert.equal(JSON.parse(during.confirmedPayloadJson).supplierName, "Ručná oprava");
  assert.equal(during.note, "Nezabudnúť");

  await writeExtractedPayload(INVOICE_ID, newPayload, "complete", null);
  assert.equal(extractedDocumentNumber((await getDocument(INVOICE_ID))!.extractedPayloadJson), "OLD");
  assert.deepEqual(await finalizeReextraction(INVOICE_ID), { outcome: "complete", reason: null, sources: [], documentIds: [INVOICE_ID] });

  const after = (await getDocument(INVOICE_ID))!;
  assert.equal(extractedDocumentNumber(after.extractedPayloadJson), "NEW");
  assert.deepEqual(JSON.parse(after.confirmedPayloadJson), {});
  assert.equal(after.note, "Nezabudnúť");
  assert.equal(after.replacementPending, false);
  assert.equal(after.extractionPipelineVersion, EXTRACTION_PIPELINE_VERSION);
});

test("failed manual replacement discards the staged result and preserves active fields", async () => {
  await seed();
  const oldPayload = { kind: "extracted" as const, parties: [], documentNumber: "OLD", variableSymbol: null, issueDate: null, taxableSupplyDate: null, dueDate: null, currency: "EUR", amountCents: 100, amountLiteral: "1.00", vatRecap: [], docTypeHint: "invoice" as const };
  await writeExtractedPayload(INVOICE_ID, oldPayload, "complete", null);
  const db = getDb();
  await db.update(documents).set({ extractionPipelineVersion: 2 }).where(eq(documents.id, INVOICE_ID));
  await writeConfirmedPayload(INVOICE_ID, { supplierName: "Ručná oprava" });
  await markForReextraction(INVOICE_ID);
  await writeExtractedPayload(INVOICE_ID, {}, "failed", "Nový výsledok sa nedá prečítať");

  assert.deepEqual(await finalizeReextraction(INVOICE_ID), {
    outcome: "failed",
    reason: "Nový výsledok sa nedá prečítať",
    sources: [],
    documentIds: [INVOICE_ID],
  });
  const after = (await getDocument(INVOICE_ID))!;
  assert.equal(extractedDocumentNumber(after.extractedPayloadJson), "OLD");
  assert.equal(JSON.parse(after.confirmedPayloadJson).supplierName, "Ručná oprava");
  assert.equal(after.extractionFailureReason, "Nový výsledok sa nedá prečítať");
  assert.equal(after.extractionPipelineVersion, 2);
});

test("an interrupted manual replacement fails with a reason and preserves the active version", async () => {
  await seed();
  const oldPayload = { kind: "extracted" as const, parties: [], documentNumber: "OLD", variableSymbol: null, issueDate: null, taxableSupplyDate: null, dueDate: null, currency: "EUR", amountCents: 100, amountLiteral: "1.00", vatRecap: [], docTypeHint: "invoice" as const };
  await writeExtractedPayload(INVOICE_ID, oldPayload, "complete", null);
  const db = getDb();
  await db.update(documents).set({ extractionPipelineVersion: 2 }).where(eq(documents.id, INVOICE_ID));
  await markForReextraction(INVOICE_ID);

  assert.deepEqual(await finalizeReextraction(INVOICE_ID, "Extractor is unreachable"), {
    outcome: "failed",
    reason: "Extractor is unreachable",
    sources: [],
    documentIds: [INVOICE_ID],
  });
  const after = (await getDocument(INVOICE_ID))!;
  assert.equal(extractedDocumentNumber(after.extractedPayloadJson), "OLD");
  assert.equal(after.extractionPipelineVersion, 2);
  assert.equal(after.replacementPending, false);
  assert.equal(after.stagedExtractedPayloadJson, null);
});

test("a newly discovered extra receipt is removed when replacement fails", async () => {
  await seed();
  const db = getDb();
  const oldPayload = { kind: "extracted" as const, parties: [], documentNumber: "OLD", variableSymbol: null, issueDate: null, taxableSupplyDate: null, dueDate: null, currency: "EUR", amountCents: 100, amountLiteral: "1.00", vatRecap: [], docTypeHint: "invoice" as const };
  await writeExtractedPayload(INVOICE_ID, oldPayload, "complete", null);
  await db.update(documents).set({ note: "Ponechať", extractionPipelineVersion: 2 }).where(eq(documents.id, INVOICE_ID));
  await markForReextraction(INVOICE_ID);

  await upsertEkasaExtractedPayload({
    documentId: `${INVOICE_ID}#new`,
    driveFileId: INVOICE_ID,
    receiptUid: "new",
    companyId: 1,
    monthKey: "2026_05",
    folderSlot: "02 Prijaté faktúry",
    payload: {},
    extractionStatus: "failed",
    extractionFailureReason: "Druhý bloček sa nedá prečítať",
    createdAt: "2026-05-12T10:00:00.000Z",
  });
  assert.equal((await db.select().from(documents).where(eq(documents.driveFileId, INVOICE_ID))).length, 2);

  await finalizeReextraction(INVOICE_ID);
  const rows = await db.select().from(documents).where(eq(documents.driveFileId, INVOICE_ID));
  assert.deepEqual(rows.map((row) => row.id), [INVOICE_ID]);
  assert.equal(rows[0]!.note, "Ponechať");
  assert.equal(extractedDocumentNumber(rows[0]!.extractedPayloadJson), "OLD");
});

test("a sparse success replaces every document from a multi-receipt file", async () => {
  await seed();
  const db = getDb();
  await db.insert(documents).values({
    id: `${INVOICE_ID}#second`,
    driveFileId: INVOICE_ID,
    receiptUid: "second",
    companyId: 1,
    monthKey: "2026_05",
    folderSlot: "02 Prijaté faktúry",
    extractionStatus: "complete",
    extractedPayloadJson: JSON.stringify({ kind: "extracted", documentNumber: "OLD-2" }),
    confirmedPayloadJson: JSON.stringify({ supplierName: "Ručná oprava 2" }),
    note: "Poznámka 2",
    createdAt: "2026-05-10T00:00:00.000Z",
  });
  await markForReextraction(INVOICE_ID);
  await writeExtractedPayload(INVOICE_ID, { kind: "extracted", parties: [], documentNumber: "NEW-1", variableSymbol: null, issueDate: null, taxableSupplyDate: null, dueDate: null, currency: "EUR", amountCents: 1, amountLiteral: "0.01", vatRecap: [], docTypeHint: "invoice" }, "complete", null);
  await finalizeReextraction(INVOICE_ID);

  const rows = await db.select().from(documents).where(eq(documents.driveFileId, INVOICE_ID));
  assert.equal(rows.length, 2);
  assert.equal(extractedDocumentNumber(rows.find((row) => row.id === INVOICE_ID)!.extractedPayloadJson), "NEW-1");
  assert.deepEqual(parseExtractedPayload(rows.find((row) => row.id.endsWith("#second"))!.extractedPayloadJson), {});
  assert.deepEqual(JSON.parse(rows.find((row) => row.id.endsWith("#second"))!.confirmedPayloadJson), {});
  assert.equal(rows.find((row) => row.id.endsWith("#second"))!.note, "Poznámka 2");
});
