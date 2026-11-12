import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "../../../src/lib/db/client.ts";
import { migrateLegacyFolderDefaults } from "../../../src/lib/db/folder-defaults.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";
import { DEFAULT_MOVABLE_FOLDER_NAMES } from "../../../src/modules/folder-settings.ts";

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

// The 2026-08 defaults (ADR 0007 amendment, 2026-11-11), as stored before the change.
const LEGACY_CANONICAL = [
  "01 Vystavené faktúry",
  "02 Prijaté faktúry",
  "03 Bankové výpisy",
  "04 Bločky_hotovosť",
  "05 Bločky_firemná karta",
  "06 Iné doklady",
  "07 Mzdy",
];

const LEGACY_MOVABLE = [
  "02 Prijaté faktúry",
  "04 Bločky_hotovosť",
  "05 Bločky_firemná karta",
  "06 Iné doklady",
];

async function storeRow(
  client: PGlite,
  canonicalJson: string,
  movableJson: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO settings (id, canonical_folder_names_json, movable_folder_names_json)
     VALUES (1, $1, $2)`,
    [canonicalJson, movableJson],
  );
}

async function storedLists(client: PGlite): Promise<{ canonical: string[]; movable: string[] | null }> {
  const result = await client.query<{ canonical: string; movable: string | null }>(
    `SELECT canonical_folder_names_json AS canonical, movable_folder_names_json AS movable
       FROM settings WHERE id = 1`,
  );
  const row = result.rows[0]!;
  return {
    canonical: JSON.parse(row.canonical) as string[],
    movable: row.movable === null ? null : (JSON.parse(row.movable) as string[]),
  };
}

test("a stored legacy default is replaced by the office's names", async () => {
  const client = await migratedClient();
  await storeRow(client, JSON.stringify(LEGACY_CANONICAL), JSON.stringify(LEGACY_MOVABLE));

  await migrateLegacyFolderDefaults(client);

  const stored = await storedLists(client);
  assert.deepEqual(stored.canonical, [...CANONICAL_FOLDER_NAMES]);
  assert.deepEqual(stored.movable, [...DEFAULT_MOVABLE_FOLDER_NAMES]);
});

test("the migration is idempotent", async () => {
  const client = await migratedClient();
  await storeRow(client, JSON.stringify(LEGACY_CANONICAL), JSON.stringify(LEGACY_MOVABLE));

  await migrateLegacyFolderDefaults(client);
  const afterFirst = await storedLists(client);
  await migrateLegacyFolderDefaults(client);

  assert.deepEqual(await storedLists(client), afterFirst);
});

test("customised lists are left alone", async () => {
  const client = await migratedClient();
  const customisedCanonical = [...LEGACY_CANONICAL, "08 Pokladňa"];
  const customisedMovable = ["06 Ostatné dokumenty"];
  await storeRow(client, JSON.stringify(customisedCanonical), JSON.stringify(customisedMovable));

  await migrateLegacyFolderDefaults(client);

  const stored = await storedLists(client);
  assert.deepEqual(stored.canonical, customisedCanonical);
  assert.deepEqual(stored.movable, customisedMovable);
});

test("each list is judged on its own", async () => {
  const client = await migratedClient();
  // The canonical list still has the old default; the movable list was customised.
  await storeRow(client, JSON.stringify(LEGACY_CANONICAL), JSON.stringify(["06 Ostatné dokumenty"]));

  await migrateLegacyFolderDefaults(client);

  const stored = await storedLists(client);
  assert.deepEqual(stored.canonical, [...CANONICAL_FOLDER_NAMES]);
  assert.deepEqual(stored.movable, ["06 Ostatné dokumenty"]);
});

test("a null movable list is left null, so it keeps reading the new default", async () => {
  const client = await migratedClient();
  await storeRow(client, JSON.stringify(LEGACY_CANONICAL), null);

  await migrateLegacyFolderDefaults(client);

  const stored = await storedLists(client);
  assert.deepEqual(stored.canonical, [...CANONICAL_FOLDER_NAMES]);
  assert.equal(stored.movable, null);
});

test("a database with no settings row is left alone", async () => {
  const client = await migratedClient();
  await migrateLegacyFolderDefaults(client);

  const result = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM settings");
  assert.equal(result.rows[0]!.count, 0);
});

// The 2026-11-11 defaults (seven names, cash and card apart), replaced by the office's eight types.
const NOVEMBER_CANONICAL = [
  "01 Vystavené faktúry",
  "02 Prijaté faktúry",
  "03 Bankové výpisy",
  "04 Platby hotovosťou",
  "05 Platby kartou",
  "06 Iné doklady",
  "07 Mzdy",
];
const NOVEMBER_MOVABLE = ["02 Prijaté faktúry", "04 Platby hotovosťou", "05 Platby kartou", "06 Iné doklady"];

test("the seven-name default of 2026-11-11 moves to the office's eight document types", async () => {
  const client = await migratedClient();
  await storeRow(client, JSON.stringify(NOVEMBER_CANONICAL), JSON.stringify(NOVEMBER_MOVABLE));

  await migrateLegacyFolderDefaults(client);

  assert.deepEqual(await storedLists(client), {
    canonical: [...CANONICAL_FOLDER_NAMES],
    movable: [...DEFAULT_MOVABLE_FOLDER_NAMES],
  });
});
