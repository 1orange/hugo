import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { listMonthFolders } from "../../../src/adapters/store/month-folders.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { ensureFreshSweep, sweepDrive } from "../../../src/lib/sweep/ensure-fresh-sweep.ts";
import { buildMonthView } from "../../../src/lib/sweep/views.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";
import {
  closeCompanyMonth,
  reopenCompanyMonth,
} from "../../../src/lib/month-lifecycle/service.ts";
import {
  applyFolderRename,
} from "../../../src/lib/drive-mutations/apply-rename.ts";
import { getOpenMonthKey } from "../../../src/adapters/store/months.ts";
import { companies, driveMutations, events, files, months } from "../../../src/lib/db/schema.ts";
import { freshTestDb } from "../support/test-db.ts";

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
      includeTypoSlot && name === "04 Bločky"
        ? "04 Platby hotorvosťou"
        : name;
    const slotId =
      includeTypoSlot && name === "04 Bločky"
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

async function setup() {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const fixture = buildFixture();
  const client = new FakeDriveClient(fixture);
  return { client, fixture };
}

/** Drive's entries by id: the fixture is what the fake Drive holds. */
function driveIds(fixture: ReturnType<typeof buildFixture>): string[] {
  return fixture.map((entry) => entry.id).sort();
}

test("an older month can be closed after a newer one is already open", async () => {
  const { client } = await setup();
  await runSweep(client);
  const company = (await getDb().select().from(companies).limit(1))[0];
  assert.ok(company);

  // Closing March opens April, which is now the newest month without a
  // closedAt. March is reopened, so both are open at once — exactly the state
  // she is in when a late month is finished after a newer one was started.
  assert.equal((await closeCompanyMonth(company.id, "2026_03")).ok, true);
  assert.equal((await reopenCompanyMonth(company.id, "2026_03")).ok, true);
  assert.equal(await getOpenMonthKey(company.id), "2026_03");

  const closedOlder = await closeCompanyMonth(company.id, "2026_03");
  assert.equal(closedOlder.ok, true);

  assert.ok(
    (await getDb().select().from(months).where(eq(months.monthKey, "2026_03")).limit(1))[0]
      ?.closedAt,
  );
});

test("a month that is already closed still cannot be closed again", async () => {
  const { client } = await setup();
  await runSweep(client);
  const company = (await getDb().select().from(companies).limit(1))[0];
  assert.ok(company);

  assert.equal((await closeCompanyMonth(company.id, "2026_03")).ok, true);
  const again = await closeCompanyMonth(company.id, "2026_03");
  assert.equal(again.ok, false);
  if (!again.ok) {
    assert.match(again.message, /uzavretý/i);
  }
});

test("close month writes closedAt and MonthClosed, and creates nothing in Drive", async () => {
  const { client, fixture } = await setup();
  await runSweep(client);
  const company = (await getDb().select().from(companies).limit(1))[0];
  assert.ok(company);

  const vatBefore = fixture.find((entry) => entry.id === VAT_PDF_ID);
  assert.ok(vatBefore);
  const driveBefore = driveIds(fixture);

  const result = await closeCompanyMonth(company.id, "2026_03");
  assert.equal(result.ok, true);

  const closed = (
    await getDb()
      .select()
      .from(months)
      .where(eq(months.monthKey, "2026_03"))
      .limit(1)
  )[0];
  assert.ok(closed?.closedAt);

  const closedEvents = (await getDb().select().from(events).orderBy(events.id)).filter((row) => row.type === "MonthClosed");
  assert.equal(closedEvents.length, 1);
  assert.equal(closedEvents[0]?.actor, "user");

  // Nothing is created in Drive: not the next month, not its subfolders.
  assert.deepEqual(driveIds(fixture), driveBefore);
  assert.equal(fixture.some((entry) => entry.name === "2026_04"), false);
  assert.equal((await getDb().select().from(months).where(eq(months.monthKey, "2026_04"))).length, 0);
  assert.equal((await getDb().select().from(driveMutations)).length, 0);

  const vatAfter = fixture.find((entry) => entry.id === VAT_PDF_ID);
  assert.equal(vatAfter?.name, vatBefore.name);
  assert.equal(vatAfter?.parents[0], MONTH_MAR);
  assert.equal(
    (await getDb().select().from(files).where(eq(files.driveFileId, VAT_PDF_ID)).limit(1))[0]?.name,
    "Daňové priznanie DPH.pdf",
  );
});

test("reopen clears closedAt, emits MonthReopened and changes nothing in Drive", async () => {
  const { client, fixture } = await setup();
  await runSweep(client);
  const company = (await getDb().select().from(companies).limit(1))[0];
  assert.ok(company);

  await closeCompanyMonth(company.id, "2026_03");
  const driveBefore = driveIds(fixture);

  const reopen = await reopenCompanyMonth(company.id, "2026_03");
  assert.equal(reopen.ok, true);

  const month = (
    await getDb()
      .select()
      .from(months)
      .where(eq(months.monthKey, "2026_03"))
      .limit(1)
  )[0];
  assert.equal(month?.closedAt, null);

  const reopenedEvents = (await getDb().select().from(events).orderBy(events.id)).filter((row) => row.type === "MonthReopened");
  assert.equal(reopenedEvents.length, 1);
  assert.deepEqual(driveIds(fixture), driveBefore);
});

test("a dashboard load and a sweep create no missing month subfolders", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);

  const slots = CANONICAL_FOLDER_NAMES.slice(0, 2).map((name, index) =>
    folder(`partial-slot-${index}`, name, [MONTH_MAR]),
  );
  const fixture = [
    folder(PARENT_ID, "Clients", []),
    folder(COMPANY_ID, "Zeta s.r.o.", [PARENT_ID]),
    folder(MONTH_MAR, "2026_03", [COMPANY_ID]),
    ...slots,
  ];
  // The dashboard and the poll build their Drive client from this fixture.
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    DRIVE_CLIENT: "fake",
    DRIVE_PARENT_FOLDER_ID: PARENT_ID,
    DRIVE_FIXTURE_JSON: JSON.stringify(fixture),
  };

  await ensureFreshSweep(env);
  await sweepDrive(env, { onlyIfStale: false });

  const company = (await getDb().select().from(companies).limit(1))[0];
  assert.ok(company);
  const folders = await listMonthFolders(company.id, "2026_03");
  assert.deepEqual(
    folders.map((entry) => entry.name).sort(),
    CANONICAL_FOLDER_NAMES.slice(0, 2).sort(),
  );
  assert.equal(
    (await getDb().select().from(events)).some((row) => row.type === "FolderCreated"),
    false,
  );
});

test("a missing destination slot is a warning, and it clears once someone creates the folder", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const missingName = CANONICAL_FOLDER_NAMES[3]!;
  const fixture = buildFixture().filter((entry) => entry.id !== "close-slot-3");
  const client = new FakeDriveClient(fixture);

  await runSweep(client);
  const company = (await getDb().select().from(companies).limit(1))[0];
  assert.ok(company);

  const warned = await buildMonthView(company.id, "2026_03");
  assert.deepEqual(
    warned?.missingSlots.map((slot) => slot.canonicalName),
    [missingName],
  );
  assert.equal(warned?.missingSlots[0]?.blockedByFolderName, null);

  // A sweep does not create it: the warning stays and Drive has no new entry.
  const driveBefore = driveIds(fixture);
  await runSweep(client);
  assert.deepEqual(driveIds(fixture), driveBefore);
  assert.equal(
    (await buildMonthView(company.id, "2026_03"))?.missingSlots.length,
    1,
  );

  // The office creates the folder in Drive; the next sweep sees it.
  fixture.push(folder("close-slot-3", missingName, [MONTH_MAR]));
  await runSweep(client);
  assert.deepEqual(
    (await buildMonthView(company.id, "2026_03"))?.missingSlots,
    [],
  );
});

test("closed month rejects folder rename server-side", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = new FakeDriveClient(buildFixture(true));
  await runSweep(client);
  const company = (await getDb().select().from(companies).limit(1))[0];
  assert.ok(company);

  await closeCompanyMonth(company.id, "2026_03");

  const rename = await applyFolderRename(client, company.id, {
    driveFileId: "close-slot-typo",
    currentName: "04 Platby hotorvosťou",
    targetName: "04 Bločky",
    parentId: MONTH_MAR,
  });
  assert.equal(rename.ok, false);
  if (!rename.ok) {
    assert.match(rename.message, /len na čítanie/i);
  }
});
