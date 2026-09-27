import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CANONICAL_FOLDER_NAMES, classifyFolder } from "../../../src/modules/folder-taxonomy.ts";
import { DEFAULT_MOVABLE_FOLDER_NAMES } from "../../../src/modules/folder-settings.ts";
import { getDb, resetDbForTests, runMigrations } from "../../../src/lib/db/migrate.ts";
import {
  getSettings,
  resolveDriveParentFolderId,
  setDriveParentFolderId,
  updateCanonicalFolderNames,
  updateMovableFolderNames,
} from "../../../src/adapters/store/settings.ts";
import { events } from "../../../src/lib/db/schema.ts";
import { saveGlobalSettings } from "../../../src/lib/settings/service.ts";

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-settings-")),
    "test.db",
  );
}

function setupDb(): string {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  return dbPath;
}

test("getSettings seeds movable folder defaults", () => {
  setupDb();
  const row = getSettings();
  assert.deepEqual(row.movableFolderNames, [...DEFAULT_MOVABLE_FOLDER_NAMES]);
});

test("updateCanonicalFolderNames normalises NFD entries to NFC on save", () => {
  setupDb();
  const nfd = CANONICAL_FOLDER_NAMES.map((name) => name.normalize("NFD"));
  const result = updateCanonicalFolderNames(nfd);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const stored = getSettings().canonicalFolderNames;
  assert.deepEqual(stored, [...CANONICAL_FOLDER_NAMES]);
  assert.equal(
    classifyFolder("04 Bločky_hotovosť".normalize("NFD"), {
      canonicalFolderNames: stored,
    }).kind,
    "canonical",
  );
});

test("resolveDriveParentFolderId prefers stored value over environment", () => {
  setupDb();
  process.env.DRIVE_PARENT_FOLDER_ID = "env-parent";
  setDriveParentFolderId("stored-parent");
  assert.equal(resolveDriveParentFolderId(), "stored-parent");
});

test("resolveDriveParentFolderId falls back to environment when unset", () => {
  setupDb();
  process.env.DRIVE_PARENT_FOLDER_ID = "env-parent";
  assert.equal(resolveDriveParentFolderId(), "env-parent");
});

test("saveGlobalSettings emits settings change events", () => {
  setupDb();
  process.env.DRIVE_PARENT_FOLDER_ID = "env-parent";

  const result = saveGlobalSettings({
    driveParentFolderId: "stored-parent",
    canonicalFolderNames: [...CANONICAL_FOLDER_NAMES],
    movableFolderNames: ["02 Prijaté faktúry", "06 Iné doklady"],
    autoAdvanceAfterDecision: true,
  });
  assert.equal(result.ok, true);

  const db = getDb();
  const rows = db.select().from(events).all();
  const types = rows.map((row) => row.type);
  assert.ok(types.includes("DriveParentFolderIdChanged"));
  assert.ok(types.includes("MovableFolderNamesChanged"));
  assert.equal(
    rows.find((row) => row.type === "MovableFolderNamesChanged")?.companyId,
    null,
  );
});

test("updateMovableFolderNames rejects names outside the canonical list", () => {
  setupDb();
  const result = updateMovableFolderNames(["99 Not canonical"]);
  assert.equal(result.ok, false);
});
