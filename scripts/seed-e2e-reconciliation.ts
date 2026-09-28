import fs from "node:fs";
import path from "node:path";
import { isNull, sql } from "drizzle-orm";
import { runMigrations, resetDbForTests, getDb } from "../src/lib/db/migrate.ts";
import { documents } from "../src/lib/db/schema.ts";
import { seedE2eDatabase } from "../src/lib/e2e/seed-e2e.ts";

async function main(): Promise<void> {
  const dbPath = path.resolve(process.cwd(), "data", "e2e.db");

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);
  await seedE2eDatabase();

  const db = getDb();
  const awaiting = db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(isNull(documents.decision))
    .get();
  console.log(
    "E2E document seed complete:",
    dbPath,
    `(${awaiting?.count ?? 0} documents awaiting decision)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
