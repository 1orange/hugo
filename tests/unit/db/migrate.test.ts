import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { isPostgresStarting, MIGRATIONS_FOLDER, runMigrations } from "../../../src/lib/db/client.ts";

const clients: PGlite[] = [];

after(async () => {
  await Promise.all(clients.map((client) => client.close()));
});

async function migratedClient(): Promise<PGlite> {
  const client = new PGlite();
  clients.push(client);
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  return client;
}

async function tableNames(client: PGlite): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  return result.rows.map((row) => row.table_name);
}

async function appliedMigrationCount(client: PGlite): Promise<number> {
  const result = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  return result.rows[0]!.count;
}

test("migrations apply to a fresh database and are idempotent", async () => {
  const client = await migratedClient();

  const tablesAfterFirst = await tableNames(client);
  const appliedAfterFirst = await appliedMigrationCount(client);
  assert.ok(appliedAfterFirst >= 1);

  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

  assert.deepEqual(await tableNames(client), tablesAfterFirst);
  assert.equal(await appliedMigrationCount(client), appliedAfterFirst);
});

test("migrations create the app tables", async () => {
  const client = await migratedClient();
  const tables = await tableNames(client);

  for (const table of [
    "companies",
    "company_profiles",
    "documents",
    "drive_mutations",
    "events",
    "files",
    "month_folders",
    "months",
    "partners",
    "settings",
  ]) {
    assert.ok(tables.includes(table), `missing table ${table}`);
  }
});

test("migrations create the unique indexes", async () => {
  const client = await migratedClient();
  const result = await client.query<{ indexname: string; indexdef: string }>(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
  );
  const unique = new Set(
    result.rows
      .filter((row) => row.indexdef.startsWith("CREATE UNIQUE INDEX"))
      .map((row) => row.indexname),
  );

  for (const index of [
    "documents_company_export_number",
    "documents_file_receipt",
    "partners_company_country_ico",
  ]) {
    assert.ok(unique.has(index), `missing unique index ${index}`);
  }
});

// On k3s every pod starts at once; Postgres is often last.
test("a replica that starts before Postgres waits for it, then gives up", async (t) => {
  const warnings: unknown[] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args[0]));
  // Nothing listens on port 1: refused, as while Postgres starts.
  await assert.rejects(
    runMigrations("postgres://hugo:x@127.0.0.1:1/hugo", { attempts: 3, delayMs: 10 }),
    (error: { code?: string }) => error.code === "ECONNREFUSED",
  );
  assert.equal(warnings.length, 2);
  assert.match(String(warnings[0]), /Postgres is not up yet \(ECONNREFUSED\)/);
});

test("an error that waiting will not fix fails at once", async (t) => {
  const warnings: unknown[] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args[0]));
  // A port no server can have: a configuration error, not a start-up.
  await assert.rejects(runMigrations("postgres://hugo:x@127.0.0.1:99999/hugo", { attempts: 3, delayMs: 10 }));
  assert.equal(warnings.length, 0);
});

test("what counts as Postgres still starting", () => {
  for (const code of ["ECONNREFUSED", "EHOSTUNREACH", "ENOTFOUND", "57P03"]) {
    assert.equal(isPostgresStarting({ code }), true, code);
  }
  // A wrong password (28P01) or an unknown database (3D000) will not change by waiting.
  for (const code of ["28P01", "3D000", "ERR_SOCKET_BAD_PORT"]) {
    assert.equal(isPostgresStarting({ code }), false, code);
  }
  assert.equal(isPostgresStarting(new Error("no code")), false);
});
