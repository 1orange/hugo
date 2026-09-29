import { count, isNull } from "drizzle-orm";
import { closeQueues } from "../src/adapters/job-queue/bullmq-queues.ts";
import { closeDb, databaseUrl, getDb, runMigrations } from "../src/lib/db/client.ts";
import { documents } from "../src/lib/db/schema.ts";
import { seedE2eDatabase } from "../src/lib/e2e/seed-e2e.ts";
import { closeRedis } from "../src/lib/redis/connection.ts";
import { ensureDatabase } from "./ensure-database.ts";

/** The e2e database from scratch, before Playwright starts the server (DATABASE_URL, e.g. hugo_e2e). */
async function main(): Promise<void> {
  const url = databaseUrl();
  await ensureDatabase(url);
  await runMigrations(url);
  await seedE2eDatabase();

  const [awaiting] = await getDb()
    .select({ count: count() })
    .from(documents)
    .where(isNull(documents.decision));
  console.log("E2E document seed complete:", new URL(url).pathname, `(${awaiting?.count ?? 0} documents awaiting decision)`);
}

main()
  .then(async () => {
    await closeQueues();
    await closeRedis();
    await closeDb();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
