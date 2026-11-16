import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeDriveClientWithChanges } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME, type DriveFileRecord } from "../../../src/modules/drive-tree.ts";
import {
  getDriveSnapshotState,
  saveDriveSnapshotState,
  setDriveParentFolderId,
} from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { applyFolderRename } from "../../../src/lib/drive-mutations/apply-rename.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, driveItems, files, monthFolders } from "../../../src/lib/db/schema.ts";
import { FULL_LISTING_AFTER_MS } from "../../../src/modules/drive-changes.ts";
import { freshTestDb } from "../support/test-db.ts";

const PARENT_ID = "incremental-parent";

function folder(id: string, name: string, parent: string | null): DriveFileRecord {
  return { id, name, parents: parent ? [parent] : [], createdTime: "2026-10-01T00:00:00.000Z", mimeType: FOLDER_MIME };
}

function pdf(id: string, parent: string): DriveFileRecord {
  return { id, name: `${id}.pdf`, parents: [parent], createdTime: "2026-10-05T00:00:00.000Z", mimeType: "application/pdf" };
}

function drive(): FakeDriveClientWithChanges {
  return new FakeDriveClientWithChanges([
    folder(PARENT_ID, "Doklady klientov", null),
    folder("company", "Doklady Kappa", PARENT_ID),
    folder("month", "2026_10", "company"),
    folder("slot-02", "02 Prijaté faktúry", "month"),
    folder("slot-typo", "04 Bločky hotovsť", "month"),
    pdf("invoice-1", "slot-02"),
  ]);
}

async function storedFile(id: string) {
  return (await getDb().select().from(files).where(eq(files.driveFileId, id)))[0];
}

test("the first sweep lists every file; later sweeps read only Drive's changes", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = drive();

  await runSweep(client);
  assert.equal(client.listCalls, 1);
  assert.equal((await getDb().select().from(driveItems)).length, 6, "the snapshot holds every item");

  client.add(pdf("invoice-2", "slot-02"));
  client.remove("invoice-1");
  await runSweep(client);

  assert.equal(client.listCalls, 1, "no second full listing");
  assert.equal(client.changesCalls, 1);
  assert.equal((await storedFile("invoice-2"))?.deleted, false, "a new file is found from the log");
  assert.equal((await storedFile("invoice-1"))?.deleted, true, "a removed file is marked deleted");
  assert.equal((await getDb().select().from(companies)).length, 1);
});

test("a quiet sweep rewrites no file", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = drive();
  await runSweep(client);
  const before = await storedFile("invoice-1");

  await runSweep(client);

  assert.deepEqual(await storedFile("invoice-1"), before, "lastSeenAt is not bumped on an unchanged row");
});

test("a rename the app made shows in the sweep that follows it, whatever Drive's log says yet", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = drive();
  await runSweep(client);
  const companyId = (await getDb().select().from(companies))[0]!.id;
  // A log that has not caught up: the rename is not in it.
  client.changesSince = async () => ({ changes: [], newStartPageToken: await client.startPageToken() });

  const result = await applyFolderRename(client, companyId, {
    driveFileId: "slot-typo",
    currentName: "04 Bločky hotovsť",
    targetName: "04 Bločky",
    parentId: "month",
  });

  assert.equal(result.ok, true);
  const item = (await getDb().select().from(driveItems).where(eq(driveItems.id, "slot-typo")))[0];
  assert.equal(item?.name, "04 Bločky");
  const slot = (await getDb().select().from(monthFolders).where(eq(monthFolders.driveFolderId, "slot-typo")))[0];
  assert.equal(slot?.name, "04 Bločky", "the screen reads the new name");
  assert.equal(client.listCalls, 1);
});

test("an expired token, or a day since the last full listing, lists everything again", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = drive();
  await runSweep(client);

  client.expiredBefore = Number(await client.startPageToken()) + 1;
  client.add(pdf("invoice-3", "slot-02"));
  await runSweep(client);
  assert.equal(client.listCalls, 2, "the log refused the token");
  assert.equal((await storedFile("invoice-3"))?.deleted, false);

  const state = await getDriveSnapshotState();
  await saveDriveSnapshotState({
    changesToken: state.changesToken,
    snapshotAt: new Date(Date.now() - FULL_LISTING_AFTER_MS).toISOString(),
  });
  client.expiredBefore = 0;
  await runSweep(client);
  assert.equal(client.listCalls, 3, "the daily full listing");
});
