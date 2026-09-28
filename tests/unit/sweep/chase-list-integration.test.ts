import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import { companies, documents, files, months } from "../../../src/lib/db/schema.ts";
import {
  listAllMonthKeys,
  listCompanySummaries,
  summariseChaseList,
} from "../../../src/lib/sweep/views.ts";

const COMPANY_A = 1;
const COMPANY_B = 2;

function tempDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hugo-chase-")), "test.db");
}

function file(
  driveFileId: string,
  companyId: number,
  monthKey: string,
  folderSlot: string | null,
  createdTime: string,
) {
  return {
    id: driveFileId,
    driveFileId,
    companyId,
    monthKey,
    folderSlot,
    parentId: `${monthKey}-parent`,
    name: `${driveFileId}.pdf`,
    mimeType: "application/pdf",
    driveCreatedTime: createdTime,
    firstSeenAt: createdTime,
    lastSeenAt: createdTime,
    deleted: false,
  };
}

function document_(
  driveFileId: string,
  companyId: number,
  monthKey: string,
  decision: string | null,
) {
  return {
    id: driveFileId,
    driveFileId,
    companyId,
    monthKey,
    folderSlot: "02 Prijaté faktúry",
    decision,
    extractionStatus: "complete",
    extractedPayloadJson: "{}",
    confirmedPayloadJson: "{}",
    createdAt: "2026-02-01T00:00:00.000Z",
  };
}

/**
 * Company A: January closed and fully decided, February open with a statement,
 * two proofs and one document still awaiting.
 * Company B: only January, still open, and nothing has arrived at all.
 */
function seed(): void {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values([
      { id: COMPANY_A, driveFolderId: "co-a", name: "Alfa s.r.o.", active: true },
      { id: COMPANY_B, driveFolderId: "co-b", name: "Beta s.r.o.", active: true },
    ])
    .run();

  db.insert(months)
    .values([
      {
        companyId: COMPANY_A,
        monthKey: "2026_01",
        driveFolderId: "a-jan",
        closedAt: "2026-02-20T10:00:00.000Z",
      },
      { companyId: COMPANY_A, monthKey: "2026_02", driveFolderId: "a-feb", closedAt: null },
      { companyId: COMPANY_B, monthKey: "2026_01", driveFolderId: "b-jan", closedAt: null },
    ])
    .run();

  db.insert(files)
    .values([
      file("a-jan-inv", COMPANY_A, "2026_01", "02 Prijaté faktúry", "2026-01-14T08:00:00.000Z"),
      file("a-feb-stmt", COMPANY_A, "2026_02", "03 Bankové výpisy", "2026-03-04T07:30:00.000Z"),
      file("a-feb-inv1", COMPANY_A, "2026_02", "02 Prijaté faktúry", "2026-02-11T09:00:00.000Z"),
      file("a-feb-inv2", COMPANY_A, "2026_02", "02 Prijaté faktúry", "2026-02-18T09:00:00.000Z"),
    ])
    .run();

  db.insert(documents)
    .values([
      document_("a-jan-inv", COMPANY_A, "2026_01", "confirmed"),
      document_("a-feb-inv1", COMPANY_A, "2026_02", "confirmed"),
      document_("a-feb-inv2", COMPANY_A, "2026_02", null),
    ])
    .run();
}

test("with no month picked, each row reports that company's own open month", () => {
  seed();
  const rows = listCompanySummaries();

  const alfa = rows.find((row) => row.id === COMPANY_A);
  assert.equal(alfa?.monthKey, "2026_02");
  assert.equal(alfa?.monthClosed, false);
  assert.equal(alfa?.proofsArrived, 2);
  assert.equal(alfa?.awaitingCount, 1);
  assert.equal(alfa?.statementArrivedAt, "2026-03-04T07:30:00.000Z");
  // Drive's created time, not our first-seen time, and `03` counts as an upload.
  assert.equal(alfa?.lastUploadAt, "2026-03-04T07:30:00.000Z");
  assert.equal(alfa?.chaseState, "decide");

  const beta = rows.find((row) => row.id === COMPANY_B);
  assert.equal(beta?.monthKey, "2026_01");
  assert.equal(beta?.chaseState, "silent");

  // The client who has sent nothing sorts above the one with work to do.
  assert.deepEqual(rows.map((row) => row.id), [COMPANY_B, COMPANY_A]);
});

test("picking a past month reports that month for every company", () => {
  seed();
  const rows = listCompanySummaries("2026_01");

  const alfa = rows.find((row) => row.id === COMPANY_A);
  assert.equal(alfa?.monthKey, "2026_01");
  assert.equal(alfa?.monthClosed, true);
  assert.equal(alfa?.proofsArrived, 1);
  assert.equal(alfa?.chaseState, "closed");
  // The company's own open month is still reported alongside the viewed month.
  assert.equal(alfa?.openMonth, "2026_02");

  const beta = rows.find((row) => row.id === COMPANY_B);
  assert.equal(beta?.monthKey, "2026_01");
  assert.equal(beta?.chaseState, "silent");
});

test("a company without the picked month says so rather than reading as idle", () => {
  seed();
  const rows = listCompanySummaries("2026_02");

  const beta = rows.find((row) => row.id === COMPANY_B);
  assert.equal(beta?.monthKey, null);
  assert.equal(beta?.chaseState, "no-month");
  assert.equal(beta?.awaitingCount, null);
});

test("the month picker offers every month any company has, newest first", () => {
  seed();
  assert.deepEqual(listAllMonthKeys(), ["2026_02", "2026_01"]);
});

test("a closed month is not counted as missing a statement", () => {
  seed();
  const open = summariseChaseList(listCompanySummaries());
  // February has a statement; Beta's January has none.
  assert.equal(open.withoutStatement, 1);
  assert.equal(open.awaitingTotal, 1);
  assert.equal(open.silent, 1);

  const january = summariseChaseList(listCompanySummaries("2026_01"));
  // Alfa's January is closed, so it is not chased for a statement it never got.
  assert.equal(january.withoutStatement, 1);
});
