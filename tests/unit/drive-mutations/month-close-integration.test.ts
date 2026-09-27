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
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";
import {
  closeCompanyMonth,
  reopenCompanyMonth,
  scaffoldOpenMonthIfNeeded,
} from "../../../src/lib/month-lifecycle/service.ts";
import {
  applyFolderRename,
} from "../../../src/lib/drive-mutations/apply-rename.ts";
import { getOpenMonthKey } from "../../../src/adapters/store/months.ts";
import { companies, driveMutations, events, files, months } from "../../../src/lib/db/schema.ts";

const PARENT_ID = "close-parent";
const COMPANY_ID = "close-company";
const MONTH_MAR = "close-month-mar";
const VAT_PDF_ID = "close-vat-pdf";

function folder(id: string, name: string, parents: string[]) {
  return {
    id,
    name,
    parents,
    createdTime: "2026-03-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  };
}

function buildFixture(includeTypoSlot = false) {
  const slots = CANONICAL_FOLDER_NAMES.map((name, index) => {
    const slotName =
      includeTypoSlot && name === "04 Bločky_hotovosť"
        ? "04 Bločky_hotorvosť"
        : name;
    const slotId =
      includeTypoSlot && name === "04 Bločky_hotovosť"
        ? "close-slot-typo"
        : `close-slot-${index}`;
    return folder(slotId, slotName, [MONTH_MAR]);
  });
  return [
    folder(PARENT_ID, "Clients", []),
    folder(COMPANY_ID, "Epsilon s.r.o.", [PARENT_ID]),
    folder(MONTH_MAR, "2026_03", [COMPANY_ID]),
    ...slots,
    {
      id: VAT_PDF_ID,
      name: "Daňové priznanie DPH.pdf",
      parents: [MONTH_MAR],
      createdTime: "2026-03-25T00:00:00.000Z",
      mimeType: "application/pdf",
    },
  ];
}

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-close-")),
    "test.db",
  );
}

function setup() {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);
  const fixture = buildFixture();
  const client = new FakeDriveClient(fixture);
  return { client, fixture, dbPath };
}

test("an older month can be closed after a newer one is already open", async () => {
  const { client } = setup();
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  // Closing March opens April, which is now the newest month without a
  // closedAt. March is reopened, so both are open at once — exactly the state
  // she is in when a late month is finished after a newer one was started.
  assert.equal((await closeCompanyMonth(client, company.id, "2026_03")).ok, true);
  assert.equal((await reopenCompanyMonth(company.id, "2026_03")).ok, true);
  assert.equal(getOpenMonthKey(company.id), "2026_04");

  const closedOlder = await closeCompanyMonth(client, company.id, "2026_03");
  assert.equal(closedOlder.ok, true);

  assert.ok(
    getDb().select().from(months).where(eq(months.monthKey, "2026_03")).get()
      ?.closedAt,
  );
  // April is untouched by closing a month behind it.
  assert.equal(
    getDb().select().from(months).where(eq(months.monthKey, "2026_04")).get()
      ?.closedAt,
    null,
  );
  assert.equal(getOpenMonthKey(company.id), "2026_04");
});

test("a month that is already closed still cannot be closed again", async () => {
  const { client } = setup();
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  assert.equal((await closeCompanyMonth(client, company.id, "2026_03")).ok, true);
  const again = await closeCompanyMonth(client, company.id, "2026_03");
  assert.equal(again.ok, false);
  if (!again.ok) {
    assert.match(again.message, /uzavretý/i);
  }
});

test("close month writes closedAt, scaffolds next month, leaves VAT PDF untouched", async () => {
  const { client, fixture } = setup();
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  const vatBefore = fixture.find((entry) => entry.id === VAT_PDF_ID);
  assert.ok(vatBefore);

  const result = await closeCompanyMonth(client, company.id, "2026_03");
  assert.equal(result.ok, true);

  const closed = getDb()
    .select()
    .from(months)
    .where(eq(months.monthKey, "2026_03"))
    .get();
  assert.ok(closed?.closedAt);

  const closedEvents = getDb()
    .select()
    .from(events)
    .all()
    .filter((row) => row.type === "MonthClosed");
  assert.equal(closedEvents.length, 1);
  assert.equal(closedEvents[0]?.actor, "user");

  const aprilMonth = getDb()
    .select()
    .from(months)
    .where(eq(months.monthKey, "2026_04"))
    .get();
  assert.ok(aprilMonth);

  const aprilFolders = fixture.filter(
    (entry) => entry.parents[0] === aprilMonth?.driveFolderId,
  );
  assert.equal(aprilFolders.length, CANONICAL_FOLDER_NAMES.length);
  for (const name of CANONICAL_FOLDER_NAMES) {
    assert.ok(aprilFolders.some((entry) => entry.name === name));
  }

  const vatAfter = fixture.find((entry) => entry.id === VAT_PDF_ID);
  assert.equal(vatAfter?.name, vatBefore.name);
  assert.equal(vatAfter?.parents[0], MONTH_MAR);
  assert.equal(
    getDb().select().from(files).where(eq(files.driveFileId, VAT_PDF_ID)).get()?.name,
    "Daňové priznanie DPH.pdf",
  );

  const createMutations = getDb()
    .select()
    .from(driveMutations)
    .all()
    .filter((row) => row.kind === "create");
  assert.ok(createMutations.length >= CANONICAL_FOLDER_NAMES.length);
  assert.ok(createMutations.every((row) => row.status === "applied"));
});

test("scaffolding is idempotent on second close safety-net run", async () => {
  const { client, fixture } = setup();
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  await closeCompanyMonth(client, company.id, "2026_03");
  const aprilMonth = getDb()
    .select()
    .from(months)
    .where(eq(months.monthKey, "2026_04"))
    .get();
  assert.ok(aprilMonth);

  const countBefore = fixture.filter(
    (entry) => entry.parents[0] === aprilMonth.driveFolderId,
  ).length;

  await scaffoldOpenMonthIfNeeded(client, company.id);
  const countAfter = fixture.filter(
    (entry) => entry.parents[0] === aprilMonth.driveFolderId,
  ).length;
  assert.equal(countAfter, countBefore);
});

test("reopen clears closedAt and emits MonthReopened", async () => {
  const { client } = setup();
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  await closeCompanyMonth(client, company.id, "2026_03");
  const reopen = await reopenCompanyMonth(company.id, "2026_03");
  assert.equal(reopen.ok, true);

  const month = getDb()
    .select()
    .from(months)
    .where(eq(months.monthKey, "2026_03"))
    .get();
  assert.equal(month?.closedAt, null);

  const reopenedEvents = getDb()
    .select()
    .from(events)
    .all()
    .filter((row) => row.type === "MonthReopened");
  assert.equal(reopenedEvents.length, 1);
});

test("dashboard safety net scaffolds missing open-month folders", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);

  const slots = CANONICAL_FOLDER_NAMES.slice(0, 2).map((name, index) =>
    folder(`partial-slot-${index}`, name, [MONTH_MAR]),
  );
  const fixture = [
    folder(PARENT_ID, "Clients", []),
    folder(COMPANY_ID, "Zeta s.r.o.", [PARENT_ID]),
    folder(MONTH_MAR, "2026_03", [COMPANY_ID]),
    ...slots,
  ];
  const client = new FakeDriveClient(fixture);
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  await scaffoldOpenMonthIfNeeded(client, company.id);

  const created = fixture.filter((entry) => entry.parents[0] === MONTH_MAR);
  assert.equal(created.length, CANONICAL_FOLDER_NAMES.length);
});

test("closed month rejects folder rename server-side", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  setDriveParentFolderId(PARENT_ID);
  const client = new FakeDriveClient(buildFixture(true));
  await runSweep(client);
  const company = getDb().select().from(companies).get();
  assert.ok(company);

  await closeCompanyMonth(client, company.id, "2026_03");

  const rename = await applyFolderRename(client, company.id, {
    driveFileId: "close-slot-typo",
    currentName: "04 Bločky_hotorvosť",
    targetName: "04 Bločky_hotovosť",
    parentId: MONTH_MAR,
  });
  assert.equal(rename.ok, false);
  if (!rename.ok) {
    assert.match(rename.message, /len na čítanie/i);
  }
});
