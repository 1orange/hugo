import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../../../src/lib/db/migrate.ts";

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-migrate-")),
    "test.db",
  );
}

test("runMigrations creates database and is idempotent", () => {
  const dbPath = tempDbPath();

  runMigrations(dbPath);
  assert.ok(fs.existsSync(dbPath));

  const afterFirst = fs.statSync(dbPath).size;

  runMigrations(dbPath);
  const afterSecond = fs.statSync(dbPath).size;

  assert.equal(afterSecond, afterFirst);
});

test("runMigrations creates companies table", async () => {
  const dbPath = tempDbPath();
  runMigrations(dbPath);

  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath);
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'companies'",
    )
    .get() as { name: string } | undefined;

  assert.equal(row?.name, "companies");
  db.close();
});
