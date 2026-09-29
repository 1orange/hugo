import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { ensureDocumentsForMonth, getDocument } from "../../../src/adapters/store/documents.ts";
import { companies, documents, events, files, months } from "../../../src/lib/db/schema.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { lookupEkasaUidForDocument } from "../../../src/lib/documents/lookup-ekasa-uid.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import {
  isEkasaPayload,
  parseConfirmedPayload,
  parseExtractedPayload,
} from "../../../src/modules/document-payload.ts";
import { SYNTHETIC_FIXTURE } from "../cash-discovery/synthetic-ekasa-lines.ts";
import { syntheticEkasaOpdResponse } from "../cash-discovery/synthetic-ekasa-opd.ts";
import { freshTestDb } from "../support/test-db.ts";

const RECEIPT_ID = "uid-box-receipt";

async function seed(): Promise<void> {
  await freshTestDb();

  const db = getDb();
  await db.insert(companies)
    .values({ id: 1, driveFolderId: "c1", name: "Test", active: true });
  await db.insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_04",
      driveFolderId: "m1",
      closedAt: null,
      openedAt: "2026-04-01T00:00:00.000Z",
    });
  await db.insert(files)
    .values({
      driveFileId: RECEIPT_ID,
      companyId: 1,
      monthKey: "2026_04",
      folderSlot: "04 Bločky_hotovosť",
      parentId: "m1",
      name: "photo-receipt.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-04-10T00:00:00.000Z",
      firstSeenAt: "2026-04-10T00:00:00.000Z",
      lastSeenAt: "2026-04-10T00:00:00.000Z",
      deleted: false,
    });
  await ensureDocumentsForMonth(1, "2026_04", "2026-04-10T00:00:00.000Z");
}

test("valid UID fills extracted lookup payload and records event", async () => {
  await seed();

  const confirmedBefore = parseConfirmedPayload(
    (await getDocument(RECEIPT_ID))!.confirmedPayloadJson,
  );
  confirmedBefore.supplierName = "Her correction";
  await getDb()
    .update(documents)
    .set({ confirmedPayloadJson: JSON.stringify(confirmedBefore) })
    .where(eq(documents.driveFileId, RECEIPT_ID));

  const lookup = new FakeEkasaLookup({
    responses: {
      [SYNTHETIC_FIXTURE.uid]: { ok: true, raw: syntheticEkasaOpdResponse() },
    },
  });

  const result = await lookupEkasaUidForDocument({
    companyId: 1,
    monthKey: "2026_04",
    documentId: RECEIPT_ID,
    uidRaw: SYNTHETIC_FIXTURE.uid,
    ekasaLookup: lookup,
    now: "2026-04-11T10:00:00.000Z",
  });

  assert.equal(result.ok, true);
  if (!result.ok || !result.found) {
    assert.fail("expected lookup success");
  }

  const payload = parseExtractedPayload((await getDocument(RECEIPT_ID))!.extractedPayloadJson);
  assert.ok(isEkasaPayload(payload));
  assert.equal(payload.source, "lookup");
  assert.equal(payload.supplierName, SYNTHETIC_FIXTURE.supplierName);

  const confirmedAfter = parseConfirmedPayload(
    (await getDocument(RECEIPT_ID))!.confirmedPayloadJson,
  );
  assert.equal(confirmedAfter.supplierName, "Her correction");

  const event = (
    await getDb()
      .select()
      .from(events)
      .where(eq(events.type, "EkasaUidEntered"))
      .limit(1)
  )[0];
  assert.ok(event);
  assert.match(event.payloadJson, new RegExp(SYNTHETIC_FIXTURE.uid));

  const view = await buildMonthDocumentView(1, "2026_04");
  const item = view!.documents.find((doc) => doc.driveFileId === RECEIPT_ID);
  assert.equal(item?.showUidBox, false);
});

test("unknown UID stores typed value without changing extracted fields", async () => {
  await seed();

  const lookup = new FakeEkasaLookup();
  const beforeJson = (await getDocument(RECEIPT_ID))!.extractedPayloadJson;

  const result = await lookupEkasaUidForDocument({
    companyId: 1,
    monthKey: "2026_04",
    documentId: RECEIPT_ID,
    uidRaw: SYNTHETIC_FIXTURE.uid,
    ekasaLookup: lookup,
  });

  assert.equal(result.ok, true);
  if (!result.ok || result.found) {
    assert.fail("expected not found");
  }

  assert.equal(
    (await getDocument(RECEIPT_ID))!.extractedPayloadJson.includes(SYNTHETIC_FIXTURE.uid),
    true,
  );
  const payload = parseExtractedPayload((await getDocument(RECEIPT_ID))!.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), false);
  assert.equal(parseExtractedPayload(beforeJson).kind, undefined);
});

test("closed month rejects UID lookup", async () => {
  await seed();
  await getDb()
    .update(months)
    .set({ closedAt: "2026-04-30T00:00:00.000Z" })
    .where(eq(months.id, 1));

  const result = await lookupEkasaUidForDocument({
    companyId: 1,
    monthKey: "2026_04",
    documentId: RECEIPT_ID,
    uidRaw: SYNTHETIC_FIXTURE.uid,
    ekasaLookup: new FakeEkasaLookup(),
  });

  assert.equal(result.ok, false);
});
