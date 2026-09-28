import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { stubTextLinesForDriveFile } from "../../../src/adapters/extractor/stub-fixtures.ts";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FakeEkasaLookup } from "../../../src/adapters/ekasa-lookup/fake-ekasa-lookup.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import { emptyQrReader } from "../../../src/adapters/qr-reader/fake-qr-reader.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import { documents } from "../../../src/lib/db/schema.ts";
import { createDocumentExtractionQueue } from "../../../src/lib/extraction-queue/document-queue.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";

const INVOICES = ["doc-invoice-a", "doc-invoice-b"];

function tree() {
  const folder = (id: string, name: string, parent: string | null) => ({
    id,
    name,
    parents: parent ? [parent] : [],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  });
  return [
    folder("parent", "Clients", null),
    folder("company", "Delta s.r.o.", "parent"),
    folder("month", "2026_01", "company"),
    folder("slot-02", "02 Prijaté faktúry", "month"),
    ...INVOICES.map((id) => ({
      id,
      name: `${id}.pdf`,
      parents: ["slot-02"],
      createdTime: "2026-01-05T00:00:00.000Z",
      mimeType: "application/pdf",
    })),
  ];
}

// The month view re-renders every 1.5 s while documents are pending, and each
// render queues the month again; a document must still be read once.
test("queuing a month again while it is being read reads each document once", async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hugo-queue-")), "test.db");
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  const driveClient = new FakeDriveClient(
    tree(),
    Object.fromEntries(INVOICES.map((id) => [id, new Uint8Array(Buffer.from("pdf"))])),
  );
  setDriveParentFolderId("parent");
  await runSweep(driveClient);

  const pdfAccess: PdfAccess = {
    async extractTextLines() {
      return stubTextLinesForDriveFile("doc-invoice-a")!;
    },
    async extractAttachments() {
      return [];
    },
    async extractPageImages() {
      return [];
    },
  };
  const stub = createStubExtractor();
  const asked: string[] = [];
  let running = 0;
  let peak = 0;
  const extractor = {
    async extract(input: Parameters<typeof stub.extract>[0]) {
      asked.push(input.driveFileId);
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return stub.extract({ ...input, driveFileId: "doc-invoice-a" });
    },
  };
  const queue = createDocumentExtractionQueue(
    {
      driveClient,
      pdfAccess,
      qrReader: emptyQrReader(),
      ekasaLookup: new FakeEkasaLookup(),
      ocr: new FakeOcr(),
      extractor,
      now: () => "2026-01-12T10:00:00.000Z",
    },
    1,
  );

  assert.equal(queue.enqueueMonth(1, "2026_01"), 2);
  // Re-renders while the first document is with the model.
  for (let render = 0; render < 5; render += 1) {
    assert.equal(queue.enqueueMonth(1, "2026_01"), 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await queue.onIdle();

  assert.deepEqual([...asked].sort(), INVOICES);
  assert.equal(peak, 1);
  for (const id of INVOICES) {
    const row = getDb().select().from(documents).where(eq(documents.driveFileId, id)).get()!;
    assert.equal(row.extractionStatus, "complete", id);
  }
  // Read documents are not queued again.
  assert.equal(queue.enqueueMonth(1, "2026_01"), 0);
});
