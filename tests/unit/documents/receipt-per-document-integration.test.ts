import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, files, months } from "../../../src/lib/db/schema.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import { confirmDocument } from "../../../src/lib/documents/service.ts";
import { buildMonthOmegaExport } from "../../../src/lib/omega-export/service.ts";
import { mapOpdResponseToEkasaPayload } from "../../../src/modules/ekasa-lookup-mapping.ts";
import { serializeExtractedPayload } from "../../../src/modules/document-payload.ts";
import { receiptDocumentId } from "../../../src/modules/receipt-identity.ts";
import { syntheticEkasaOpdResponse } from "../cash-discovery/synthetic-ekasa-opd.ts";
import { freshTestDb } from "../support/test-db.ts";

const MONTH = "2026_05";
const SCAN = "scan-two-receipts";
const OTHER = "second-copy";
const FIRST_UID = "O-11111111111111111111111111111111";
const SECOND_UID = "O-22222222222222222222222222222222";

function receiptPayloadJson(uid: string, receiptNumber: number, totalPrice: number): string {
  const raw = structuredClone(syntheticEkasaOpdResponse()) as {
    receipt: {
      receiptId: string;
      receiptNumber: number;
      totalPrice: number;
      items: Array<{ price: number }>;
    };
  };
  raw.receipt.receiptId = uid;
  raw.receipt.receiptNumber = receiptNumber;
  raw.receipt.totalPrice = totalPrice;
  raw.receipt.items = [{ ...raw.receipt.items[0]!, price: totalPrice }];
  const mapped = mapOpdResponseToEkasaPayload({ requestedUid: uid, raw });
  assert.ok(mapped.ok, "synthetic receipt must map");
  return serializeExtractedPayload(mapped.payload);
}

async function seed() {
  const db = await freshTestDb();
  const companyId = (
    await db
      .insert(companies)
      .values({ driveFolderId: "c1", name: "Acme", active: true })
      .returning({ id: companies.id })
  )[0]!.id;
  await db
    .insert(months)
    .values({ companyId, monthKey: MONTH, driveFolderId: "m1", closedAt: null, openedAt: "2026-05-01T00:00:00.000Z" });
  const now = "2026-05-20T10:00:00.000Z";
  for (const [driveFileId, name] of [[SCAN, "Scan 2026-5-10 18.25.50.pdf"], [OTHER, "2026-08-17_094358.pdf"]] as const) {
    await db
      .insert(files)
      .values({
        driveFileId,
        companyId,
        monthKey: MONTH,
        folderSlot: "05 Bločky_firemná karta",
        parentId: "slot-05",
        name,
        mimeType: "application/pdf",
        driveCreatedTime: now,
        firstSeenAt: now,
        lastSeenAt: now,
        deleted: false,
      });
  }
  const document = (id: string, driveFileId: string, receiptUid: string | null, payloadJson: string, createdAt: string) => ({
    id,
    driveFileId,
    receiptUid,
    companyId,
    monthKey: MONTH,
    folderSlot: "05 Bločky_firemná karta",
    extractionStatus: "complete",
    extractedPayloadJson: payloadJson,
    confirmedPayloadJson: "{}",
    createdAt,
  });
  await db
    .insert(documents)
    .values([
      document(SCAN, SCAN, null, receiptPayloadJson(FIRST_UID, 485, 18), "2026-05-20T10:00:00.000Z"),
      document(receiptDocumentId(SCAN, SECOND_UID), SCAN, SECOND_UID, receiptPayloadJson(SECOND_UID, 4860, 20.08), "2026-05-20T10:00:01.000Z"),
      // The first receipt scanned a second time, into another file.
      document(OTHER, OTHER, null, receiptPayloadJson(FIRST_UID, 485, 18), "2026-05-20T10:00:02.000Z"),
    ]);
  return companyId;
}

test("each receipt of a scan is its own document, and knows its place in the file", async () => {
  const companyId = await seed();
  const view = (await buildMonthDocumentView(companyId, MONTH))!;
  const byId = new Map(view.documents.map((item) => [item.id, item]));

  assert.equal(view.documents.length, 3);
  assert.equal(view.awaitingCount, 3);
  assert.deepEqual(byId.get(SCAN)!.receiptOfFile, { index: 1, count: 2 });
  assert.deepEqual(byId.get(receiptDocumentId(SCAN, SECOND_UID))!.receiptOfFile, { index: 2, count: 2 });
  assert.equal(byId.get(OTHER)!.receiptOfFile, null);
  // Both receipts of the scan preview the same file.
  assert.equal(byId.get(receiptDocumentId(SCAN, SECOND_UID))!.driveFileId, SCAN);
});

test("the same receipt in two files is flagged on both", async () => {
  const companyId = await seed();
  const view = (await buildMonthDocumentView(companyId, MONTH))!;
  const byId = new Map(view.documents.map((item) => [item.id, item]));

  assert.deepEqual(byId.get(OTHER)!.sameReceiptAs.map((other) => other.id), [SCAN]);
  assert.deepEqual(byId.get(SCAN)!.sameReceiptAs.map((other) => other.id), [OTHER]);
  assert.deepEqual(byId.get(receiptDocumentId(SCAN, SECOND_UID))!.sameReceiptAs, []);
});

test("the export writes every receipt of a scan and holds back a receipt booked twice", async () => {
  const companyId = await seed();
  for (const documentId of [SCAN, receiptDocumentId(SCAN, SECOND_UID), OTHER]) {
    assert.deepEqual(
      await confirmDocument({ companyId, monthKey: MONTH, documentId, confirmed: true, now: "2026-05-21T10:00:00.000Z" }),
      { ok: true },
    );
  }

  const { preview } = await buildMonthOmegaExport({ companyId, monthKey: MONTH, register: null, persist: false });

  assert.deepEqual(
    preview.included.map((row) => row.documentId).sort(),
    [SCAN, receiptDocumentId(SCAN, SECOND_UID)].sort(),
  );
  assert.equal(preview.heldBack.length, 1);
  assert.equal(preview.heldBack[0]!.documentId, OTHER);
  assert.match(preview.heldBack[0]!.reason, /Rovnaký bloček.*Scan 2026-5-10 18\.25\.50\.pdf/);
  // Both receipts of the scan get their own export number.
  const numbers = preview.included.map((row) => row.exportNumber);
  assert.equal(new Set(numbers).size, 2);
});

test("a scan's receipts stay together in the list, even when found later", async () => {
  const companyId = await seed();
  const THIRD_UID = "V-33333333333333333333333333333333";
  await getDb()
    .insert(documents)
    .values({
      id: receiptDocumentId(SCAN, THIRD_UID),
      driveFileId: SCAN,
      receiptUid: THIRD_UID,
      companyId,
      monthKey: MONTH,
      folderSlot: "05 Bločky_firemná karta",
      extractionStatus: "complete",
      extractedPayloadJson: receiptPayloadJson(THIRD_UID, 7, 5),
      confirmedPayloadJson: "{}",
      createdAt: "2026-05-22T10:00:00.000Z",
    });

  const view = (await buildMonthDocumentView(companyId, MONTH))!;

  assert.deepEqual(
    view.documents.map((item) => item.id),
    [SCAN, receiptDocumentId(SCAN, SECOND_UID), receiptDocumentId(SCAN, THIRD_UID), OTHER],
  );
  assert.deepEqual(view.documents[2]!.receiptOfFile, { index: 3, count: 3 });
});
