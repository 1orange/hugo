import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { buildMonthView } from "../../../src/lib/sweep/views.ts";
import {
  applyFolderRename,
  undoFolderRename,
} from "../../../src/lib/drive-mutations/apply-rename.ts";
import { companies, driveMutations, events, files } from "../../../src/lib/db/schema.ts";
import { eq } from "drizzle-orm";

const PARENT_ID = "mutation-parent";
const COMPANY_ID = "mutation-company";
const MONTH_ID = "mutation-month";
const TYPO_SLOT_ID = "mutation-slot-typo";
const DOC_ID = "mutation-doc";

function folder(
  id: string,
  name: string,
  parents: string[],
  capabilities?: { canRename: boolean; canMoveItemWithinDrive: boolean },
) {
  return {
    id,
    name,
    parents,
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
    capabilities,
  };
}

function buildFixture() {
  return [
    folder(PARENT_ID, "Clients", []),
    folder(COMPANY_ID, "Delta s.r.o.", [PARENT_ID]),
    folder(MONTH_ID, "2026_03", [COMPANY_ID]),
    folder(TYPO_SLOT_ID, "04 Bločky_hotorvosť", [MONTH_ID]),
    {
      id: DOC_ID,
      name: "receipt.pdf",
      parents: [TYPO_SLOT_ID],
      createdTime: "2026-03-05T00:00:00.000Z",
      mimeType: "application/pdf",
    },
  ];
}

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-mutation-")),
    "test.db",
  );
}

test("folder rename: propose, confirm, verify fake Drive, undo, verify events", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const fixture = buildFixture();
  const client = new FakeDriveClient(fixture);

  await runSweep(client);
  const db = getDb();
  const company = db.select().from(companies).get();
  assert.ok(company);

  const beforeFile = db
    .select()
    .from(files)
    .where(eq(files.driveFileId, DOC_ID))
    .get();
  assert.ok(beforeFile);
  assert.equal(beforeFile.folderSlot, "04 Bločky_hotorvosť");

  const applyResult = await applyFolderRename(client, company.id, {
    driveFileId: TYPO_SLOT_ID,
    currentName: "04 Bločky_hotorvosť",
    targetName: "04 Bločky_hotovosť",
    parentId: MONTH_ID,
  });
  assert.equal(applyResult.ok, true);

  const renamedFolder = fixture.find((entry) => entry.id === TYPO_SLOT_ID);
  assert.equal(renamedFolder?.name, "04 Bločky_hotovosť");

  const mutationRows = db.select().from(driveMutations).all();
  assert.equal(mutationRows.length, 1);
  assert.equal(mutationRows[0]?.previousName, "04 Bločky_hotorvosť");
  assert.equal(mutationRows[0]?.newName, "04 Bločky_hotovosť");
  assert.equal(mutationRows[0]?.undoneAt, null);

  const afterFile = db
    .select()
    .from(files)
    .where(eq(files.driveFileId, DOC_ID))
    .get();
  assert.ok(afterFile);
  assert.equal(afterFile.driveFileId, DOC_ID);
  assert.equal(afterFile.firstSeenAt, beforeFile.firstSeenAt);
  assert.equal(afterFile.folderSlot, "04 Bločky_hotovosť");

  const renamedEvents = db
    .select()
    .from(events)
    .all()
    .filter((row) => row.type === "Renamed");
  assert.equal(renamedEvents.length, 1);
  assert.equal(renamedEvents[0]?.actor, "user");

  const secondSweep = await runSweep(client);
  assert.equal(secondSweep.eventCount, 0);

  const undoResult = await undoFolderRename(client, mutationRows[0]!.id);
  assert.equal(undoResult.ok, true);

  const restoredFolder = fixture.find((entry) => entry.id === TYPO_SLOT_ID);
  assert.equal(restoredFolder?.name, "04 Bločky_hotorvosť");

  const undoneMutation = db
    .select()
    .from(driveMutations)
    .where(eq(driveMutations.id, mutationRows[0]!.id))
    .get();
  assert.ok(undoneMutation?.undoneAt);

  const restoredFile = db
    .select()
    .from(files)
    .where(eq(files.driveFileId, DOC_ID))
    .get();
  assert.equal(restoredFile?.folderSlot, "04 Bločky_hotorvosť");
  assert.equal(restoredFile?.driveFileId, DOC_ID);
  assert.equal(restoredFile?.firstSeenAt, beforeFile.firstSeenAt);

  const allRenamedEvents = db
    .select()
    .from(events)
    .all()
    .filter((row) => row.type === "Renamed");
  assert.equal(allRenamedEvents.length, 2);
  assert.ok(
    allRenamedEvents.every(
      (row) => row.timestamp <= allRenamedEvents[1]!.timestamp,
    ),
  );
});

test("a repaired folder reads as canonical-with-undo, not as an open problem", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const client = new FakeDriveClient(buildFixture());
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  const before = buildMonthView(company.id, "2026_03");
  const beforeGroup = before?.groups.find(
    (group) => group.driveFolderId === TYPO_SLOT_ID,
  );
  assert.equal(beforeGroup?.kind, "repair-candidate");
  assert.equal(beforeGroup?.activeMutationId, null);

  assert.equal(
    (
      await applyFolderRename(client, company.id, {
        driveFileId: TYPO_SLOT_ID,
        currentName: "04 Bločky_hotorvosť",
        targetName: "04 Bločky_hotovosť",
        parentId: MONTH_ID,
      })
    ).ok,
    true,
  );

  /*
   * After the rename the folder is canonical. It still carries the mutation id
   * because undo stays available (ADR 0006), but that is a finished action, not
   * an unresolved problem — the screen must not keep counting it as one and
   * offering undo as the only move.
   */
  const after = buildMonthView(company.id, "2026_03");
  const afterGroup = after?.groups.find(
    (group) => group.driveFolderId === TYPO_SLOT_ID,
  );
  assert.equal(afterGroup?.kind, "canonical");
  assert.equal(afterGroup?.observedName, "04 Bločky_hotovosť");
  assert.ok(afterGroup?.activeMutationId);

  const stillBroken = after?.groups.filter(
    (group) => group.kind === "repair-candidate" || group.kind === "unknown",
  );
  assert.deepEqual(stillBroken, []);
});

test("a rename that fails mid-flight still leaves a reversible record", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const fixture = buildFixture();
  const client = new FakeDriveClient(fixture);
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  // Drive accepted the request and then failed. Without a record written before
  // the call, the folder's previous name would be unrecoverable.
  const failing = new FakeDriveClient(fixture);
  failing.rename = async () => {
    throw new Error("503 backend error");
  };

  const result = await applyFolderRename(failing, company.id, {
    driveFileId: TYPO_SLOT_ID,
    currentName: "04 Bločky_hotorvosť",
    targetName: "04 Bločky_hotovosť",
    parentId: MONTH_ID,
  });

  assert.equal(result.ok, false);

  const row = getDb().select().from(driveMutations).get();
  assert.ok(row, "the attempt must be recorded even though it failed");
  assert.equal(row.status, "failed");
  assert.equal(row.previousName, "04 Bločky_hotorvosť");
  assert.equal(row.appliedAt, null);
  assert.match(row.failureMessage ?? "", /503/);

  // A failed attempt must not be offered as undoable.
  const undo = await undoFolderRename(client, row.id);
  assert.equal(undo.ok, false);
});

test("undo refuses when the folder was renamed again afterwards", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const fixture = buildFixture();
  const client = new FakeDriveClient(fixture);
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  const applied = await applyFolderRename(client, company.id, {
    driveFileId: TYPO_SLOT_ID,
    currentName: "04 Bločky_hotorvosť",
    targetName: "04 Bločky_hotovosť",
    parentId: MONTH_ID,
  });
  assert.equal(applied.ok, true);
  assert.ok(applied.ok);

  await client.rename(TYPO_SLOT_ID, "04 Bločky_hotovosť ARCHIV");
  await runSweep(client);

  const undo = await undoFolderRename(client, applied.mutationId);
  assert.equal(undo.ok, false);
  if (!undo.ok) {
    assert.match(undo.message, /ARCHIV/);
  }

  const folderNow = fixture.find((entry) => entry.id === TYPO_SLOT_ID);
  assert.equal(folderNow?.name, "04 Bločky_hotovosť ARCHIV");
});

test("a target outside the canonical list never reaches Drive", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const fixture = buildFixture();
  const client = new FakeDriveClient(fixture);
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  const result = await applyFolderRename(client, company.id, {
    driveFileId: TYPO_SLOT_ID,
    currentName: "04 Bločky_hotorvosť",
    targetName: "../../etc anything she never chose",
    parentId: MONTH_ID,
  });

  assert.equal(result.ok, false);
  assert.equal(
    fixture.find((entry) => entry.id === TYPO_SLOT_ID)?.name,
    "04 Bločky_hotorvosť",
  );
  assert.equal(getDb().select().from(driveMutations).all().length, 0);
});

test("applyFolderRename refuses when canRename is false", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const fixture = buildFixture();
  const blockedFolder = fixture.find((entry) => entry.id === TYPO_SLOT_ID);
  if (blockedFolder) {
    blockedFolder.capabilities = {
      canRename: false,
      canMoveItemWithinDrive: true,
    };
  }

  const client = new FakeDriveClient(fixture);
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  const result = await applyFolderRename(client, company.id, {
    driveFileId: TYPO_SLOT_ID,
    currentName: "04 Bločky_hotorvosť",
    targetName: "04 Bločky_hotovosť",
    parentId: MONTH_ID,
    capabilities: { canRename: false, canMoveItemWithinDrive: true },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /cannot be renamed/i);
  }
  assert.equal(getDb().select().from(driveMutations).all().length, 0);
});
