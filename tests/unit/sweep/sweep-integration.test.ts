import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { freshTestDb } from "../support/test-db.ts";
import { companies, events, files } from "../../../src/lib/db/schema.ts";

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
