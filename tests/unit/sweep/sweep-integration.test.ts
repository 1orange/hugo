import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { freshTestDb } from "../support/test-db.ts";
import { companies, documents, events, files } from "../../../src/lib/db/schema.ts";

const PARENT_ID = "integration-parent";
const COMPANY_ID = "integration-company";
const MONTH_ID = "integration-month";
const SLOT_ID = "integration-slot-02";

const fixture = [
  {
    id: PARENT_ID,
    name: "Clients",
    parents: [] as string[],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: COMPANY_ID,
    name: "Gamma s.r.o.",
    parents: [PARENT_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: MONTH_ID,
    name: "2026_02",
    parents: [COMPANY_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: SLOT_ID,
    name: "02 Prijaté faktúry",
    parents: [MONTH_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: "integration-doc",
    name: "supplier-a.pdf",
    parents: [SLOT_ID],
    createdTime: "2026-02-05T00:00:00.000Z",
    mimeType: "application/pdf",
  },
  {
    id: "integration-vat",
    name: "vat-summary.pdf",
    parents: [MONTH_ID],
    createdTime: "2026-02-20T00:00:00.000Z",
    mimeType: "application/pdf",
  },
];

test("runSweep persists tree, events and files; second run is a no-op", async () => {
  await freshTestDb();

  await setDriveParentFolderId(PARENT_ID);
  const client = new FakeDriveClient(fixture);

  const first = await runSweep(client);
  assert.equal(first.companyCount, 1);
  assert.equal(first.eventCount, 2);

  const db = getDb();
  const companyRows = await db.select().from(companies);
  assert.equal(companyRows.length, 1);
  assert.equal(companyRows[0]?.name, "Gamma s.r.o.");

  const fileRows = await db.select().from(files);
  assert.equal(fileRows.length, 2);
  assert.deepEqual(
    fileRows.map((row) => row.name).sort(),
    ["supplier-a.pdf", "vat-summary.pdf"],
  );

  const eventRows = await db.select().from(events).orderBy(events.id);
  assert.equal(eventRows.length, 2);
  assert.ok(eventRows.every((row) => row.type === "FileDiscovered"));

  const second = await runSweep(client);
  assert.equal(second.eventCount, 0);
  assert.equal((await db.select().from(events).orderBy(events.id)).length, 2);
});

// Sweeps before the system-files rule recorded desktop.ini as a document,
// pending for ever. The next sweep forgets it, unless she decided on it.
test("a sweep forgets the system files an older sweep recorded", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const withSystemFiles = [
    ...fixture,
    { id: "old-desktop-ini", name: "desktop.ini", parents: [SLOT_ID], createdTime: "2026-02-01T00:00:00.000Z", mimeType: "text/plain" },
  ];
  await runSweep(new FakeDriveClient(withSystemFiles));

  const db = getDb();
  const companyId = (await db.select().from(companies))[0]!.id;
  const stored = (driveFileId: string, name: string) => ({
    driveFileId,
    companyId,
    monthKey: "2026_02",
    folderSlot: "02 Prijaté faktúry",
    parentId: SLOT_ID,
    name,
    mimeType: "text/plain",
    driveCreatedTime: "2026-02-01T00:00:00.000Z",
    firstSeenAt: "2026-02-01T00:00:00.000Z",
    lastSeenAt: "2026-02-01T00:00:00.000Z",
    deleted: false,
  });
  const pending = (driveFileId: string, decision: string | null = null) => ({
    id: driveFileId,
    driveFileId,
    companyId,
    monthKey: "2026_02",
    folderSlot: "02 Prijaté faktúry",
    decision,
    createdAt: "2026-02-01T00:00:00.000Z",
  });
  // As a sweep before the rule left them: the files, and documents for them.
  await db.insert(files).values([stored("old-desktop-ini", "desktop.ini"), stored("decided-thumbs", "Thumbs.db")]);
  await db.insert(documents).values([pending("old-desktop-ini"), pending("decided-thumbs", "not_relevant")]);

  await runSweep(new FakeDriveClient(withSystemFiles));

  const fileIds = (await db.select().from(files)).map((row) => row.driveFileId).sort();
  assert.deepEqual(fileIds, ["decided-thumbs", "integration-doc", "integration-vat"]);
  const documentIds = (await db.select().from(documents)).map((row) => row.id);
  assert.equal(documentIds.includes("old-desktop-ini"), false);
  assert.equal(documentIds.includes("decided-thumbs"), true);
});
