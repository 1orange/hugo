import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "../../../src/lib/db/client.ts";

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
