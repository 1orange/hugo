import path from "node:path";
import Database from "better-sqlite3";
import { getTableColumns, getTableName, sql, type Table } from "drizzle-orm";
import { closeDb, getDb, runMigrations } from "../src/lib/db/client.ts";
import * as schema from "../src/lib/db/schema.ts";

/**
 * Copies a SQLite database of the app (ADR 0004, before ADR 0021) into the
 * Postgres DATABASE_URL names:
 *
 *   node --import tsx --env-file=.env scripts/import-sqlite.ts [./dev.db] [--replace]
 *
 * The SQLite file is only read. Postgres must be empty, or `--replace` empties
 * it first. Ids are kept, so every reference stays; the id sequences are then
 * moved past them.
 */
const TABLES_PARENTS_FIRST: Table[] = [
  schema.companies,
  schema.companyProfiles,
  schema.settings,
  schema.months,
  schema.monthFolders,
  schema.files,
  schema.documents,
  schema.partners,
  schema.driveMutations,
  schema.events,
];
const IDENTITY_TABLES = ["companies", "months", "events", "partners", "drive_mutations"];
const BATCH = 500;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const sqlitePath = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? "./dev.db");
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });

  await runMigrations();
  const db = getDb();

  const { rows: existing } = await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM companies`);
  if ((existing[0]?.count ?? 0) > 0) {
    if (!replace) {
      throw new Error("Postgres already has companies; pass --replace to empty it first.");
    }
    await db.execute(
      sql`TRUNCATE TABLE ${sql.join(TABLES_PARENTS_FIRST, sql`, `)} RESTART IDENTITY CASCADE`,
    );
  }

  const sqliteTables = new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );

  for (const table of TABLES_PARENTS_FIRST) {
    const name = getTableName(table);
    if (!sqliteTables.has(name)) {
      console.log(`${name}: not in the SQLite file, skipped`);
      continue;
    }
    const columns = Object.entries(getTableColumns(table));
    const rows = (sqlite.prepare(`SELECT * FROM "${name}"`).all() as Array<Record<string, unknown>>).map((row) =>
      Object.fromEntries(
        columns
          .filter(([, column]) => column.name in row)
          .map(([key, column]) => {
            const value = row[column.name];
            // SQLite stored booleans as 0 and 1.
            return [key, column.dataType === "boolean" && value !== null ? Boolean(value) : value];
          }),
      ),
    );
    for (let start = 0; start < rows.length; start += BATCH) {
      await db.insert(table).values(rows.slice(start, start + BATCH) as never);
    }
    console.log(`${name}: ${rows.length}`);
  }

  for (const name of IDENTITY_TABLES) {
    await db.execute(
      sql.raw(
        `SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM ${name}), 0) + 1, false)`,
      ),
    );
  }
  sqlite.close();
  console.log(`Imported ${sqlitePath}`);
}

main()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await closeDb();
    process.exit(1);
  });
