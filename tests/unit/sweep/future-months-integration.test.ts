import { after, afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, files, months } from "../../../src/lib/db/schema.ts";
import { getOpenMonthKey } from "../../../src/adapters/store/months.ts";
import { buildMonthView, listAllMonthKeys, listCompanySummaries } from "../../../src/lib/sweep/views.ts";
import { freshTestDb } from "../support/test-db.ts";

const COMPANY_A = 1;
const COMPANY_B = 2;
const YEAR = Array.from({ length: 12 }, (_, index) => `2026_${String(index + 1).padStart(2, "0")}`);

/** Pins "now" for the code under test. Date alone is mocked; the database is not. */
function clockAt(instant: string): void {
  mock.timers.enable({ apis: ["Date"], now: new Date(instant) });
}

afterEach(() => {
  mock.timers.reset();
});

after(() => {
  mock.timers.reset();
});

/**
 * The office pre-creates the whole year for both companies. Company A has
 * January to October closed; company B has nothing closed.
 */
async function seedPreCreatedYear(): Promise<void> {
  await freshTestDb();
  const db = getDb();
  await db.insert(companies).values([
    { id: COMPANY_A, driveFolderId: "co-a", name: "Alfa s.r.o.", active: true },
    { id: COMPANY_B, driveFolderId: "co-b", name: "Beta s.r.o.", active: true },
  ]);
  const closedJanToOct = "2026-10-31T10:00:00.000Z";
  await db.insert(months).values(
    YEAR.flatMap((monthKey) => [
      {
        companyId: COMPANY_A,
        monthKey,
        driveFolderId: `a-${monthKey}`,
        closedAt: monthKey <= "2026_10" ? closedJanToOct : null,
      },
      { companyId: COMPANY_B, monthKey, driveFolderId: `b-${monthKey}`, closedAt: null },
    ]),
  );
}

test("in November the open month is November, not the pre-created December", async () => {
  clockAt("2026-11-11T09:00:00.000Z");
  await seedPreCreatedYear();

  assert.equal(await getOpenMonthKey(COMPANY_A), "2026_11");
  assert.equal(await getOpenMonthKey(COMPANY_B), "2026_11");

  const rows = await listCompanySummaries();
  assert.deepEqual(
    rows.map((row) => [row.id, row.monthKey, row.openMonth]),
    [
      [COMPANY_A, "2026_11", "2026_11"],
      [COMPANY_B, "2026_11", "2026_11"],
    ],
  );
});

test("the month picker lists only months that have started", async () => {
  clockAt("2026-11-11T09:00:00.000Z");
  await seedPreCreatedYear();

  const keys = await listAllMonthKeys();
  assert.equal(keys.includes("2026_12"), false);
  assert.equal(keys[0], "2026_11");
  assert.equal(keys.length, 11);
});

test("the dashboard never selects a future month, even when asked for one", async () => {
  clockAt("2026-11-11T09:00:00.000Z");
  await seedPreCreatedYear();

  const rows = await listCompanySummaries("2026_12");
  assert.ok(rows.every((row) => row.monthKey === "2026_11"));
});

test("on the first of the month, in Bratislava, that month becomes the open one", async () => {
  // 23:30 UTC on 30 November is already 1 December in Bratislava.
  clockAt("2026-11-30T23:30:00.000Z");
  await seedPreCreatedYear();
  await getDb()
    .update(months)
    .set({ closedAt: "2026-11-30T10:00:00.000Z" })
    .where(and(eq(months.companyId, COMPANY_A), eq(months.monthKey, "2026_11")));

  assert.equal(await getOpenMonthKey(COMPANY_A), "2026_12");
});

test("a file uploaded into a future month is noted on the open month, not moved", async () => {
  clockAt("2026-11-11T09:00:00.000Z");
  await seedPreCreatedYear();
  await getDb().insert(files).values({
    driveFileId: "early-invoice",
    companyId: COMPANY_A,
    monthKey: "2026_12",
    folderSlot: "02 Prijaté faktúry",
    parentId: "a-2026_12-parent",
    name: "faktura-december.pdf",
    mimeType: "application/pdf",
    driveCreatedTime: "2026-11-10T08:00:00.000Z",
    firstSeenAt: "2026-11-10T08:00:00.000Z",
    lastSeenAt: "2026-11-10T08:00:00.000Z",
    deleted: false,
  });

  const november = await buildMonthView(COMPANY_A, "2026_11");
  assert.deepEqual(november?.futureUploads, [{ monthKey: "2026_12", count: 1 }]);

  // Not on months that are not the open month.
  const october = await buildMonthView(COMPANY_A, "2026_10");
  assert.deepEqual(october?.futureUploads, []);
});
