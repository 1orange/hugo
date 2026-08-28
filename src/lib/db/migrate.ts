import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "hugo.db");

export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_PATH ?? DEFAULT_DB_PATH;
}

export function runMigrations(databasePath?: string): void {
  const dbPath = databasePath ?? resolveDatabasePath();
  const dir = path.dirname(dbPath);

  // ponytail: sync mkdir is fine for single-process VPS boot
  fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  try {
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    sqlite.close();
  }
}

let cachedDb: ReturnType<typeof createDb> | null = null;

function createDb(databasePath: string) {
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export function getDb(): ReturnType<typeof createDb> {
  if (!cachedDb) {
    runMigrations();
    cachedDb = createDb(resolveDatabasePath());
  }

  return cachedDb;
}

export function resetDbForTests(): void {
  cachedDb = null;
}
