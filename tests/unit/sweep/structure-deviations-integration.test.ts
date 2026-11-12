import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FOLDER_MIME, type DriveFileRecord } from "../../../src/modules/drive-tree.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { listStructureDeviationsForCompany } from "../../../src/adapters/store/structure-deviations.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { freshTestDb } from "../support/test-db.ts";
import { companies, structureDeviations } from "../../../src/lib/db/schema.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";
import { monthKeyAt } from "../../../src/modules/month-lifecycle.ts";

const PARENT_ID = "structure-parent";
const COMPANY_ID = "structure-company";
const COMPANY_NAME = "Konto Delta";
// The check reads the office clock, so the fixture follows the current year.
const YEAR = monthKeyAt(new Date()).slice(0, 4);
const PREVIOUS_YEAR_MONTH = `${Number(YEAR) - 1}_03`;

function monthKey(month: number): string {
  return `${YEAR}_${String(month).padStart(2, "0")}`;
}

function folder(id: string, name: string, parent: string): DriveFileRecord {
  return {
    id,
    name,
    parents: [parent],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  };
}

type Change = { month: string; from: string; to: string | null };

/**
 * A conforming company with twelve current-year months, plus one previous-year
 * month. The second slot is stored in NFD, as most real folders are, and must
 * never count as a deviation. Changes remove or rename a slot in one month.
 */
function layout(changes: Change[] = []): DriveFileRecord[] {
  const files: DriveFileRecord[] = [
    { id: PARENT_ID, name: "Clients", parents: [], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
    folder(COMPANY_ID, `Konto Delta`, PARENT_ID),
  ];
  const months = [...Array.from({ length: 12 }, (_, index) => monthKey(index + 1)), PREVIOUS_YEAR_MONTH];
  for (const month of months) {
    files.push(folder(`month-${month}`, month, COMPANY_ID));
    CANONICAL_FOLDER_NAMES.forEach((canonical, index) => {
      const change = changes.find((entry) => entry.month === month && entry.from === canonical);
      const name = change ? change.to : canonical;
      if (name === null) {
        return;
      }
      const stored = index === 1 ? name.normalize("NFD") : name;
      files.push(folder(`slot-${month}-${index}`, stored, `month-${month}`));
    });
  }
  return files;
}

test("a sweep stores each company's deviations, replaces them, and a fix in Drive clears them", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const broken = layout([
    { month: monthKey(3), from: "04 Bločky", to: null },
    { month: monthKey(5), from: "04 Bločky", to: "05 Platby kartu" },
    { month: PREVIOUS_YEAR_MONTH, from: "07 Mzdy", to: null },
  ]);

  await runSweep(new FakeDriveClient(broken));
  await runSweep(new FakeDriveClient(broken));

  const db = getDb();
  const companyId = (await db.select().from(companies))[0]!.id;
  const rows = await db.select().from(structureDeviations);
  assert.equal(rows.length, 2, "replaced on each sweep, not accumulated");
  assert.deepEqual(
    rows.map((row) => [row.kind, row.severity, row.path, row.monthKey, row.driveFolderId]).sort(),
    [
      ["subfolder-missing", "blocking", `Konto Delta/${monthKey(3)}/04 Bločky`, monthKey(3), null],
      ["subfolder-repair", "attention", `Konto Delta/${monthKey(5)}/05 Platby kartu`, monthKey(5), `slot-${monthKey(5)}-3`],
    ],
  );

  const stored = await listStructureDeviationsForCompany(companyId);
  assert.deepEqual(
    stored.map((deviation) => [deviation.kind, deviation.expectedName, deviation.observedName, deviation.repair]),
    [
      ["subfolder-missing", "04 Bločky", null, null],
      ["subfolder-repair", null, "05 Platby kartu", { targetName: "04 Bločky" }],
    ],
  );

  // She fixes both in Drive and the sweep runs again: nothing is left stored.
  await runSweep(new FakeDriveClient(layout()));
  assert.deepEqual(await db.select().from(structureDeviations), []);
  assert.deepEqual(await listStructureDeviationsForCompany(companyId), []);
});

test("renaming a near-miss folder in Drive clears its deviation on the next sweep", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = new FakeDriveClient(
    layout([{ month: monthKey(5), from: "04 Bločky", to: "05 Platby kartu" }]),
  );
  await runSweep(client);
  assert.equal((await getDb().select().from(structureDeviations)).length, 1);

  await client.rename(`slot-${monthKey(5)}-3`, "04 Bločky");
  await runSweep(client);
  assert.deepEqual(await getDb().select().from(structureDeviations), []);
});
