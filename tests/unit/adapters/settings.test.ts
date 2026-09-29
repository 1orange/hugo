import { test } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_FOLDER_NAMES, classifyFolder } from "../../../src/modules/folder-taxonomy.ts";
import { DEFAULT_MOVABLE_FOLDER_NAMES } from "../../../src/modules/folder-settings.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import {
  getSettings,
  resolveDriveParentFolderId,
  setDriveParentFolderId,
  updateCanonicalFolderNames,
  updateMovableFolderNames,
} from "../../../src/adapters/store/settings.ts";
import { events } from "../../../src/lib/db/schema.ts";
import { saveGlobalSettings } from "../../../src/lib/settings/service.ts";
import { freshTestDb } from "../support/test-db.ts";

test("getSettings seeds movable folder defaults", async () => {
  await freshTestDb();
  const row = await getSettings();
  assert.deepEqual(row.movableFolderNames, [...DEFAULT_MOVABLE_FOLDER_NAMES]);
});

test("updateCanonicalFolderNames normalises NFD entries to NFC on save", async () => {
  await freshTestDb();
  const nfd = CANONICAL_FOLDER_NAMES.map((name) => name.normalize("NFD"));
  const result = await updateCanonicalFolderNames(nfd);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const stored = (await getSettings()).canonicalFolderNames;
  assert.deepEqual(stored, [...CANONICAL_FOLDER_NAMES]);
  assert.equal(
    classifyFolder("04 Bločky_hotovosť".normalize("NFD"), {
      canonicalFolderNames: stored,
    }).kind,
    "canonical",
  );
});

test("resolveDriveParentFolderId prefers stored value over environment", async () => {
  await freshTestDb();
  process.env.DRIVE_PARENT_FOLDER_ID = "env-parent";
  await setDriveParentFolderId("stored-parent");
  assert.equal(await resolveDriveParentFolderId(), "stored-parent");
});

test("resolveDriveParentFolderId falls back to environment when unset", async () => {
  await freshTestDb();
  process.env.DRIVE_PARENT_FOLDER_ID = "env-parent";
  assert.equal(await resolveDriveParentFolderId(), "env-parent");
});

test("saveGlobalSettings emits settings change events", async () => {
  await freshTestDb();
  process.env.DRIVE_PARENT_FOLDER_ID = "env-parent";

  const result = await saveGlobalSettings({
    driveParentFolderId: "stored-parent",
    canonicalFolderNames: [...CANONICAL_FOLDER_NAMES],
    movableFolderNames: ["02 Prijaté faktúry", "06 Iné doklady"],
    autoAdvanceAfterDecision: true,
  });
  assert.equal(result.ok, true);

  const db = getDb();
  const rows = await db.select().from(events).orderBy(events.id);
  const types = rows.map((row) => row.type);
  assert.ok(types.includes("DriveParentFolderIdChanged"));
  assert.ok(types.includes("MovableFolderNamesChanged"));
  assert.equal(
    rows.find((row) => row.type === "MovableFolderNamesChanged")?.companyId,
    null,
  );
});

test("updateMovableFolderNames rejects names outside the canonical list", async () => {
  await freshTestDb();
  const result = await updateMovableFolderNames(["99 Not canonical"]);
  assert.equal(result.ok, false);
});
