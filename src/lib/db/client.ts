import path from "node:path";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Any 64-bit number, the same in every replica: the one they wait on while
 * one of them migrates (ADR 0021).
 */
const MIGRATION_LOCK_KEY = 7_261_670_121;

type Holder = { pool?: pg.Pool; db?: Db; override?: Db };

// One pool per process, kept across Next's module reloads in development.
const HOLDER_KEY = Symbol.for("hugo.db");

function holder(): Holder {
  const global = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (global[HOLDER_KEY] ??= {});
}

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set (postgres://user:password@host:5432/db) — see .env.example");
  }
  return url;
}

export function getDb(): Db {
  const state = holder();
  if (state.override) {
    return state.override;
  }
  if (!state.db) {
    state.pool = new pg.Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.DATABASE_POOL_MAX) || 10,
    });
    state.db = drizzle(state.pool, { schema });
  }
  return state.db;
}

/**
 * Refused, unresolvable, or up but not yet accepting connections (57P03):
 * Postgres is starting. Anything else — a wrong password, a failed migration —
 * will not fix itself by waiting.
 */
const NOT_UP_YET = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "57P03"]);

function isPostgresStarting(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && NOT_UP_YET.has(code);
}

/**
 * Applies pending migrations. Every replica runs this on start; the advisory
 * lock makes the others wait while the first migrates, then find nothing left.
 *
 * A replica that starts before Postgres waits for it. On k3s every pod starts
 * at once: the worker exited, and Next — its instrumentation hook failing —
 * answered every request with 500 until its startup probe killed it.
 */
export async function runMigrations(
  url: string = databaseUrl(),
  wait: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = wait.attempts ?? 30;
  const delayMs = wait.delayMs ?? 2000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await migrateOnce(url);
      return;
    } catch (error) {
      if (attempt >= attempts || !isPostgresStarting(error)) {
        throw error;
      }
      const code = (error as { code: string }).code;
      console.warn(`[db] Postgres is not up yet (${code}); trying again in ${delayMs / 1000} s (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function migrateOnce(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

/**
 * Runs `work` while holding a Postgres advisory lock, so replicas doing the
 * same thing take turns — two sweeps at once both saw a new file and both
 * recorded its discovery. The lock is held by a connection set aside for it;
 * `work` queries through the pool as usual.
 */
export async function withAdvisoryLock<T>(key: number, work: () => Promise<T>): Promise<T> {
  const state = holder();
  if (state.override) {
    // Tests: one in-process database, one caller at a time.
    return work();
  }
  getDb();
  const connection = await state.pool!.connect();
  try {
    await connection.query("SELECT pg_advisory_lock($1)", [key]);
    try {
      return await work();
    } finally {
      await connection.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    connection.release();
  }
}

/** Ends the pool, so a stopping process lets its connections go. */
export async function closeDb(): Promise<void> {
  const state = holder();
  const pool = state.pool;
  state.pool = undefined;
  state.db = undefined;
  await pool?.end();
}

/** Tests run against an in-process Postgres (PGlite) instead of the pool. */
export function setDbForTests(db: Db | null): void {
  holder().override = db ?? undefined;
}
