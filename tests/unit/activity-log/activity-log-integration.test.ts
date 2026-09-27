import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import {
  applyFolderRename,
} from "../../../src/lib/drive-mutations/apply-rename.ts";
import { closeCompanyMonth } from "../../../src/lib/month-lifecycle/service.ts";
import { companies } from "../../../src/lib/db/schema.ts";
import {
  listCompanyActivity,
  listGlobalActivity,
} from "../../../src/adapters/store/activity-log.ts";
import { formatActivityEntry } from "../../../src/modules/activity-log.ts";
import { saveGlobalSettings } from "../../../src/lib/settings/service.ts";

const PARENT_ID = "activity-parent";
const COMPANY_ID = "activity-company";
const MONTH_ID = "activity-month";
const TYPO_SLOT_ID = "activity-slot-typo";

function folder(id: string, name: string, parents: string[]) {
  return {
    id,
    name,
    parents,
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  };
}

function buildFixture() {
  return [
    folder(PARENT_ID, "Clients", []),
    folder(COMPANY_ID, "Theta s.r.o.", [PARENT_ID]),
    folder(MONTH_ID, "2026_03", [COMPANY_ID]),
    folder(TYPO_SLOT_ID, "04 Bločky_hotorvosť", [MONTH_ID]),
    {
      id: "activity-doc",
      name: "receipt.pdf",
      parents: [TYPO_SLOT_ID],
      createdTime: "2026-03-05T00:00:00.000Z",
      mimeType: "application/pdf",
    },
  ];
}

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-activity-")),
    "test.db",
  );
}

test("activity log returns reverse-chronological stream with filters", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const client = new FakeDriveClient(buildFixture());
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  await applyFolderRename(client, company.id, {
    driveFileId: TYPO_SLOT_ID,
    currentName: "04 Bločky_hotorvosť",
    targetName: "04 Bločky_hotovosť",
    parentId: MONTH_ID,
  });

  await closeCompanyMonth(client, company.id, "2026_03");

  const all = listCompanyActivity(company.id, {});
  const formatted = all.entries.map(formatActivityEntry);
  assert.ok(formatted.length >= 3);

  const types = formatted.map((entry) => entry.type);
  assert.ok(types.includes("FileDiscovered"));
  assert.ok(types.includes("Renamed"));
  assert.ok(types.includes("MonthClosed"));

  for (let index = 1; index < all.entries.length; index += 1) {
    assert.ok(all.entries[index - 1]!.id > all.entries[index]!.id);
  }

  const discoveries = listCompanyActivity(company.id, { eventType: "FileDiscovered" });
  assert.ok(discoveries.entries.every((row) => row.type === "FileDiscovered"));

  const marchOnly = listCompanyActivity(company.id, { monthKey: "2026_03" });
  assert.ok(marchOnly.entries.length >= 1);
  assert.ok(
    marchOnly.entries.every(
      (row) => formatActivityEntry(row).monthKey === "2026_03",
    ),
  );

  const noMonth = listCompanyActivity(company.id, { monthKey: null });
  assert.ok(
    noMonth.entries.every((row) => formatActivityEntry(row).monthKey === null),
  );

  const secondSweep = await runSweep(client);
  assert.equal(secondSweep.eventCount, 0);
  assert.equal(
    listCompanyActivity(company.id, {}).entries.length,
    all.entries.length,
  );
});

test("global settings events appear only in global activity scope", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const client = new FakeDriveClient(buildFixture());
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  saveGlobalSettings({
    driveParentFolderId: PARENT_ID,
    canonicalFolderNames: [
      "01 Vystavené faktúry",
      "02 Prijaté faktúry",
      "03 Bankové výpisy",
      "04 Bločky_hotovosť",
      "05 Bločky_firemná karta",
      "06 Iné doklady",
      "07 Mzdy",
      "08 Test slot",
    ],
    movableFolderNames: ["02 Prijaté faktúry"],
    autoAdvanceAfterDecision: false,
  });

  const companyActivity = listCompanyActivity(company.id, {});
  assert.ok(
    companyActivity.entries.every((row) => row.companyId === company.id),
  );

  const globalActivity = listGlobalActivity({});
  assert.ok(globalActivity.entries.length >= 1);
  assert.ok(globalActivity.entries.every((row) => row.companyId === null));
  assert.ok(
    globalActivity.entries.some((row) => row.type === "CanonicalFolderNamesChanged"),
  );
});
