import path from "node:path";
import { runMigrations } from "../src/lib/db/migrate";

const databasePath = process.argv[2];

runMigrations(databasePath ? path.resolve(databasePath) : undefined);
console.log("Migrations complete");
