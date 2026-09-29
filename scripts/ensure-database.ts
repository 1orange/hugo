import pg from "pg";

/**
 * Creates the database DATABASE_URL names when it is missing, through the
 * server's `postgres` database — the e2e run gets its own next to dev's.
 */
export async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Unexpected database name: ${name}`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await client.end();
  }
}
