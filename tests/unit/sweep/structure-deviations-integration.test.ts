import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDriveClient, FakeDriveClientWithChanges } from "../../../src/adapters/drive/fake-drive-client.ts";
import { MemoryExtractionJobQueue } from "../../../src/adapters/job-queue/memory-extraction-queue.ts";
import { FOLDER_MIME, type DriveFileRecord } from "../../../src/modules/drive-tree.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import {
  countStructureDeviationsByCompany,
  listStructureDeviationsForCompany,
} from "../../../src/adapters/store/structure-deviations.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { queueReadingWindow } from "../../../src/lib/extraction-queue/reading-window.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { freshTestDb } from "../support/test-db.ts";
import { companies, files, structureDeviations } from "../../../src/lib/db/schema.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";
import { bookingMonthKey, monthKeyAt } from "../../../src/modules/month-lifecycle.ts";

const PARENT_ID = "structure-parent";
const COMPANY_ID = "structure-company";
const COMPANY_NAME = "Konto Delta";
// The check reads the office clock, so the fixture follows the current year.
const YEAR = monthKeyAt(new Date()).slice(0, 4);
// The month structure is read for the booking month's year (issue 06): in
// January that is last year, so the fixture carries both years' months.
const BOOKING_YEAR = bookingMonthKey(new Date()).slice(0, 4);
const PREVIOUS_YEAR_MONTH = `${Number(YEAR) - 1}_03`;

function monthKey(month: number): string {
  return `${YEAR}_${String(month).padStart(2, "0")}`;
}

function bookingKey(month: number): string {
  return `${BOOKING_YEAR}_${String(month).padStart(2, "0")}`;
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
  const months = [
    ...new Set([
      ...Array.from({ length: 12 }, (_, index) => monthKey(index + 1)),
      ...Array.from({ length: 12 }, (_, index) => bookingKey(index + 1)),
      PREVIOUS_YEAR_MONTH,
    ]),
  ];
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

// Issue 06. The clients sit in an accountant's folder (a root folder without
// months would be read as the accountant herself), and the archive is its own group.
const ROOT = { id: PARENT_ID, name: "Clients", parents: [], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME };
const EVA = folder("eva", "Eva – doklady klientov", PARENT_ID);
const ARCHIVE = folder("archive", "Archív", PARENT_ID);

function pdf(id: string, parent: string): DriveFileRecord {
  return { id, name: `${id}.pdf`, parents: [parent], createdTime: "2026-10-05T00:00:00.000Z", mimeType: "application/pdf" };
}

/** A client that has the type folders directly in it: no year, no months (the `types` shape). */
function typesClient(): DriveFileRecord[] {
  return [
    folder("zeta", "Konto Zeta", "eva"),
    folder("zeta-invoices", "01 Vystavené faktúry", "zeta"),
    pdf("zeta-doc", "zeta-invoices"),
  ];
}

async function companyIdNamed(name: string): Promise<number> {
  const row = (await getDb().select().from(companies)).find((company) => company.name === name);
  assert.ok(row, `company ${name} is stored`);
  return row.id;
}

test("a client without the month structure is one blocking finding, its documents are not read, and an archived one is not checked", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = new FakeDriveClient([
    ROOT,
    EVA,
    ARCHIVE,
    ...typesClient(),
    folder("empty", "Konto Prázdna", "eva"),
    folder("archived", "Konto Archivovaná", "archive"),
    folder("archived-invoices", "01 Vystavené faktúry", "archived"),
    pdf("archived-doc", "archived-invoices"),
  ]);

  await runSweep(client);

  const zeta = await listStructureDeviationsForCompany(await companyIdNamed("Konto Zeta"));
  assert.deepEqual(zeta.map((deviation) => [deviation.kind, deviation.severity, deviation.path, deviation.monthKey, deviation.folderId]), [
    ["month-structure-missing", "blocking", "Konto Zeta", null, "zeta"],
  ]);
  assert.equal(zeta[0]!.layout?.kind, "types");
  assert.deepEqual(zeta[0]!.layout?.examples, ["01 Vystavené faktúry"]);

  const empty = await listStructureDeviationsForCompany(await companyIdNamed("Konto Prázdna"));
  assert.equal(empty[0]?.layout?.kind, "empty", "an empty client is listed with the issue, not left out");

  assert.deepEqual(await listStructureDeviationsForCompany(await companyIdNamed("Konto Archivovaná")), []);
  assert.deepEqual(
    (await getDb().select().from(files)).map((row) => row.driveFileId),
    [],
    "nothing is read from these layouts",
  );
  assert.equal((await countStructureDeviationsByCompany()).get(await companyIdNamed("Konto Zeta")), 1);
});

test("a repeated sweep over unchanged Drive keeps the stored deviation as it was, row and detection time included", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  // Konto Delta misses one slot (a per-month finding) and the types client is the company-level one.
  const client = new FakeDriveClient([
    ...layout([{ month: monthKey(3), from: "04 Bločky", to: null }]),
    EVA,
    ...typesClient(),
  ]);
  await runSweep(client);
  const before = await getDb().select().from(structureDeviations);
  assert.deepEqual(before.map((row) => row.kind).sort(), ["month-structure-missing", "subfolder-missing"]);

  await runSweep(client);

  assert.deepEqual(await getDb().select().from(structureDeviations), before, "nothing was rewritten");
});

test("the sweep after the month folders are made clears the finding and reads the documents in them", async () => {
  await freshTestDb();
  await setDriveParentFolderId(PARENT_ID);
  const client = new FakeDriveClientWithChanges([ROOT, EVA, ...typesClient()]);
  await runSweep(client);
  assert.equal((await getDb().select().from(structureDeviations)).length, 1);

  // The office makes the twelve months with every type folder in them, and moves the invoice into October.
  const zetaId = "zeta";
  for (let month = 1; month <= 12; month += 1) {
    const monthId = `zeta-${bookingKey(month)}`;
    client.add(folder(monthId, bookingKey(month), zetaId));
    CANONICAL_FOLDER_NAMES.forEach((name, index) => client.add(folder(`${monthId}-${index}`, name, monthId)));
  }
  client.remove("zeta-doc");
  client.remove("zeta-invoices");
  client.add(pdf("moved-invoice", `zeta-${bookingKey(10)}-0`));
  await runSweep(client);

  assert.deepEqual(await getDb().select().from(structureDeviations), [], "the finding is cleared");
  const moved = (await getDb().select().from(files)).find((row) => row.driveFileId === "moved-invoice");
  assert.equal(moved?.monthKey, bookingKey(10), "the invoice is discovered in its month");
  assert.equal(moved?.folderSlot, "01 Vystavené faktúry");

  const queue = new MemoryExtractionJobQueue();
  await queueReadingWindow(queue, { windowStart: `${BOOKING_YEAR}_01` });
  assert.ok(queue.jobs.has("moved-invoice"), "the invoice is queued for reading");
});
