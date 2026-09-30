import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeOcr, unreachableFakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import { processCashReceiptFile } from "../../../src/lib/cash-discovery/discover-cash-payments.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, files, months } from "../../../src/lib/db/schema.ts";
import type { PdfAccess, PdfPageImage } from "../../../src/adapters/pdf/port.ts";
import {
  isEkasaPayload,
  isModelExtractedPayload,
  parseExtractedPayload,
} from "../../../src/modules/document-payload.ts";
import { syntheticEkasaOpdResponse } from "../cash-discovery/synthetic-ekasa-opd.ts";
import { SYNTHETIC_FIXTURE } from "../cash-discovery/synthetic-ekasa-lines.ts";
import { freshTestDb, syncIdSequences } from "../support/test-db.ts";

const RECEIPT_ID = "ocr-photo-receipt";

function imageOnlyPdfAccess(pageImages: PdfPageImage[]): PdfAccess {
  return {
    async extractTextLines() {
      return [];
    },
    async extractAttachments() {
      return [];
    },
    async extractPageImages() {
      return pageImages;
    },
    async renderPages() {
      return [];
    },
  };
}

async function seedReceiptRow(db: ReturnType<typeof getDb>): Promise<void> {
  await db
    .insert(companies)
    .values({ id: 1, driveFolderId: "c", name: "Delta s.r.o.", active: true });
  await db
    .insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_01",
      driveFolderId: "m",
      closedAt: null,
      openedAt: "2026-01-01T00:00:00.000Z",
    });
  await syncIdSequences();
  await db
    .insert(files)
    .values({
      driveFileId: RECEIPT_ID,
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "04 Bločky_hotovosť",
      parentId: "slot",
      name: "photo.jpg",
      mimeType: "image/jpeg",
      driveCreatedTime: "2026-01-12T00:00:00.000Z",
      firstSeenAt: "2026-01-12T00:00:00.000Z",
      lastSeenAt: "2026-01-12T00:00:00.000Z",
      deleted: false,
    });
}

test("OCR text with UID resolves through lookup", async () => {
  await seedReceiptRow(await freshTestDb());

  const uid = SYNTHETIC_FIXTURE.uid;
  const lookup = new FakeEkasaLookup({
    responses: {
      [uid]: { ok: true, raw: syntheticEkasaOpdResponse() },
    },
  });
  const ocr = new FakeOcr({
    boxes: [{ text: uid, x: 0, y: 100 }],
  });

  await processCashReceiptFile(
    {
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: RECEIPT_ID,
      folderSlot: "04 Bločky_hotovosť",
      mimeType: "image/jpeg",
      fileBytes: new Uint8Array([0xff, 0xd8, 0xff]),
    },
    {
      pdfAccess: imageOnlyPdfAccess([]),
      qrReader: emptyQrReader(),
      ekasaLookup: lookup,
      ocr,
      extractor: createStubExtractor(),
    },
  );

  const row = (await getDb().select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).limit(1))[0]!;
  assert.equal(row.extractionStatus, "complete");
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), true);
  if (isEkasaPayload(payload)) {
    assert.equal(payload.source, "lookup");
    assert.equal(payload.ekasaUid, uid);
  }
  assert.equal(lookup.calls.length, 1);
  assert.equal(ocr.calls.length, 1);
});

test("OCR text without UID runs model checks with source ocr", async () => {
  await seedReceiptRow(await freshTestDb());

  const ocr = new FakeOcr({
    boxes: [
      { text: "Hotel Grand", x: 0, y: 200 },
      { text: "FA 2026/001", x: 0, y: 180 },
    ],
  });

  await processCashReceiptFile(
    {
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: RECEIPT_ID,
      folderSlot: "04 Bločky_hotovosť",
      mimeType: "application/pdf",
      fileBytes: new Uint8Array(Buffer.from("scan")),
    },
    {
      pdfAccess: imageOnlyPdfAccess([
        { kind: "rgba", data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 },
      ]),
      qrReader: emptyQrReader(),
      ekasaLookup: new FakeEkasaLookup(),
      ocr,
      extractor: createStubExtractor(),
    },
  );

  const row = (await getDb().select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).limit(1))[0]!;
  assert.equal(row.extractionStatus, "complete");
  const payload = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isModelExtractedPayload(payload), true);
  if (isModelExtractedPayload(payload)) {
    assert.equal(payload.source, "ocr");
    assert.ok(payload.fieldChecks);
  }
});

test("unreachable OCR leaves document pending", async () => {
  await seedReceiptRow(await freshTestDb());

  await processCashReceiptFile(
    {
      companyId: 1,
      monthKey: "2026_01",
      driveFileId: RECEIPT_ID,
      folderSlot: "04 Bločky_hotovosť",
      mimeType: "image/jpeg",
      fileBytes: new Uint8Array([0xff, 0xd8, 0xff]),
    },
    {
      pdfAccess: imageOnlyPdfAccess([]),
      qrReader: emptyQrReader(),
      ekasaLookup: new FakeEkasaLookup(),
      ocr: unreachableFakeOcr(),
      extractor: createStubExtractor(),
    },
  );

  const row = (await getDb().select().from(documents).where(eq(documents.driveFileId, RECEIPT_ID)).limit(1))[0]!;
  assert.equal(row.extractionStatus, "pending");
});
