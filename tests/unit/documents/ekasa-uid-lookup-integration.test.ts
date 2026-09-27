import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { ensureDocumentsForMonth, getDocument } from "../../../src/adapters/store/documents.ts";
import { companies, documents, events, files, months } from "../../../src/lib/db/schema.ts";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import { lookupEkasaUidForDocument } from "../../../src/lib/documents/lookup-ekasa-uid.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import {
  isEkasaPayload,
  parseConfirmedPayload,
  parseExtractedPayload,
} from "../../../src/modules/document-payload.ts";
import { SYNTHETIC_FIXTURE } from "../cash-discovery/synthetic-ekasa-lines.ts";
import { syntheticEkasaOpdResponse } from "../cash-discovery/synthetic-ekasa-opd.ts";

const RECEIPT_ID = "uid-box-receipt";

function tempDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hugo-uid-box-")), "test.db");
}

function seed(dbPath: string): void {
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: "c1", name: "Test", active: true })
    .run();
  db.insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_04",
      driveFolderId: "m1",
      closedAt: null,
      openedAt: "2026-04-01T00:00:00.000Z",
    })
    .run();
  db.insert(files)
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
    })
    .run();
  ensureDocumentsForMonth(1, "2026_04", "2026-04-10T00:00:00.000Z");
}

test("valid UID fills extracted lookup payload and records event", async () => {
  const dbPath = tempDbPath();
  seed(dbPath);

  const confirmedBefore = parseConfirmedPayload(
    getDocument(RECEIPT_ID)!.confirmedPayloadJson,
  );
  confirmedBefore.supplierName = "Her correction";
  getDb()
    .update(documents)
    .set({ confirmedPayloadJson: JSON.stringify(confirmedBefore) })
    .where(eq(documents.driveFileId, RECEIPT_ID))
    .run();

  const lookup = new FakeEkasaLookup({
    responses: {
      [SYNTHETIC_FIXTURE.uid]: { ok: true, raw: syntheticEkasaOpdResponse() },
    },
  });

  const result = await lookupEkasaUidForDocument({
    companyId: 1,
    monthKey: "2026_04",
    driveFileId: RECEIPT_ID,
    uidRaw: SYNTHETIC_FIXTURE.uid,
    ekasaLookup: lookup,
    now: "2026-04-11T10:00:00.000Z",
  });

  assert.equal(result.ok, true);
  if (!result.ok || !result.found) {
    assert.fail("expected lookup success");
  }

  const payload = parseExtractedPayload(getDocument(RECEIPT_ID)!.extractedPayloadJson);
  assert.ok(isEkasaPayload(payload));
  assert.equal(payload.source, "lookup");
  assert.equal(payload.supplierName, SYNTHETIC_FIXTURE.supplierName);

  const confirmedAfter = parseConfirmedPayload(getDocument(RECEIPT_ID)!.confirmedPayloadJson);
  assert.equal(confirmedAfter.supplierName, "Her correction");

  const event = getDb()
    .select()
    .from(events)
    .where(eq(events.type, "EkasaUidEntered"))
    .get();
  assert.ok(event);
  assert.match(event.payloadJson, new RegExp(SYNTHETIC_FIXTURE.uid));

  const view = buildMonthDocumentView(1, "2026_04");
  const item = view!.documents.find((doc) => doc.driveFileId === RECEIPT_ID);
  assert.equal(item?.showUidBox, false);
});

test("unknown UID stores typed value without changing extracted fields", async () => {
  const dbPath = tempDbPath();
  seed(dbPath);

  const lookup = new FakeEkasaLookup();
  const beforeJson = getDocument(RECEIPT_ID)!.extractedPayloadJson;

  const result = await lookupEkasaUidForDocument({
    companyId: 1,
    monthKey: "2026_04",
    driveFileId: RECEIPT_ID,
    uidRaw: SYNTHETIC_FIXTURE.uid,
    ekasaLookup: lookup,
  });

  assert.equal(result.ok, true);
  if (!result.ok || result.found) {
    assert.fail("expected not found");
  }

  assert.equal(getDocument(RECEIPT_ID)!.extractedPayloadJson.includes(SYNTHETIC_FIXTURE.uid), true);
  const payload = parseExtractedPayload(getDocument(RECEIPT_ID)!.extractedPayloadJson);
  assert.equal(isEkasaPayload(payload), false);
  assert.equal(parseExtractedPayload(beforeJson).kind, undefined);
});

test("closed month rejects UID lookup", async () => {
  const dbPath = tempDbPath();
  seed(dbPath);
  getDb()
    .update(months)
    .set({ closedAt: "2026-04-30T00:00:00.000Z" })
    .where(eq(months.id, 1))
    .run();

  const result = await lookupEkasaUidForDocument({
    companyId: 1,
    monthKey: "2026_04",
    driveFileId: RECEIPT_ID,
    uidRaw: SYNTHETIC_FIXTURE.uid,
    ekasaLookup: new FakeEkasaLookup(),
  });

  assert.equal(result.ok, false);
});
