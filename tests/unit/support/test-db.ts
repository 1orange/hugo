import { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER, setDbForTests, type Db } from "../../../src/lib/db/client.ts";
import * as schema from "../../../src/lib/db/schema.ts";

/**
 * Postgres in this process (PGlite), migrated once per test file — node:test
 * runs each file in its own process — and emptied before every test: a fresh
 * database costs half a second, a TRUNCATE a millisecond.
 */
let migrated: Promise<Db> | null = null;
let client: PGlite | null = null;

// Left open, PGlite keeps the test process alive for seconds after the last test.
after(async () => {
  await client?.close();
});

async function database(): Promise<Db> {
  migrated ??= (async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return db as unknown as Db;
  })();
  return migrated;
}

/** An empty, migrated database that getDb() returns until the next call. */
export async function freshTestDb(): Promise<Db> {
  const db = await database();
  setDbForTests(db);
  await db.execute(sql`TRUNCATE TABLE ${sql.join(
    [
      schema.events,
      schema.driveMutations,
      schema.documents,
      schema.partners,
      schema.companyProfiles,
      schema.files,
      schema.monthFolders,
      schema.months,
      schema.companies,
      schema.settings,
    ],
    sql`, `,
  )} RESTART IDENTITY CASCADE`);
  return db;
}

/**
 * After inserting rows with explicit ids, moves each identity sequence past
 * them. SQLite took max(id) + 1 on its own; Postgres counts on without looking.
 */
export async function syncIdSequences(): Promise<void> {
  const db = await database();
  for (const table of ["companies", "months", "events", "partners", "drive_mutations"]) {
    await db.execute(
      sql.raw(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`,
      ),
    );
  }
}
