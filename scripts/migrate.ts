import { runMigrations } from "../src/lib/db/client";

// DATABASE_URL, as the app reads it; every replica also migrates on start.
runMigrations()
  .then(() => console.log("Migrations complete"))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
