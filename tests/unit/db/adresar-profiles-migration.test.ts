import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { MIGRATIONS_FOLDER, setDbForTests, type Db } from "../../../src/lib/db/client.ts";
import * as schema from "../../../src/lib/db/schema.ts";

/**
 * ADR 0022, amended 2026-11-16: the migration that turns each client profile into its
 * Adresár subject. The database is built as it was before that migration (the journal
 * cut before it), filled with both cases, then the real migrations run.
 */

const DATA_MIGRATION = "0011_adresar_profile_data";
const clients: PGlite[] = [];

after(async () => {
  await Promise.all(clients.map((client) => client.close()));
});

/** A migrations folder holding only the migrations before `tag`: the database as it stood then. */
async function migrationsBefore(tag: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hugo-migrations-"));
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const entries = journal.entries.filter((entry) => entry.tag < tag);
  await mkdir(path.join(dir, "meta"));
  await writeFile(path.join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) {
    await copyFile(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`));
  }
  return dir;
}

type Row = Record<string, unknown>;

async function rows(client: PGlite, sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await client.query<Row>(sql, params)).rows;
}

async function one(client: PGlite, sql: string, params: unknown[] = []): Promise<Row> {
  const [row] = await rows(client, sql, params);
  assert.ok(row, `no row for ${sql}`);
  return row;
}

/** The database as it was before the migration, with both cases and the cases around them. */
async function seedBeforeMigration(client: PGlite): Promise<void> {
  const company = (id: number, name: string) =>
    client.query(
      "INSERT INTO companies (id, drive_folder_id, name, active, archived) VALUES ($1, $2, $3, true, false)",
      [id, `drive-${id}`, name],
    );
  await company(1, "Doklady Alfa s.r.o.");
  await company(2, "Doklady Beta, a. s.");
  await company(3, "Doklady Gama s.r.o.");
  await company(4, "Doklady Delta s.r.o.");
  await company(5, "Doklady Epsilon s.r.o.");

  const profile = (values: unknown[]) =>
    client.query(
      "INSERT INTO company_profiles (company_id, country, legal_name, address, ico, dic, ic_dph, register_source, saved_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      values,
    );
  // Alfa: a register lookup with VIES confirming the IČ DPH, and a subject already in the Adresár.
  await profile([1, "SK", "Alfa s.r.o.", "Pod Hradom 1, Bratislava", "31333532", "2020311335", "SK2020311335", "rpo+ruz+vies", "2026-10-01T08:00:00.000Z"]);
  // Beta: typed by hand, with no subject yet.
  await profile([2, "SK", "Beta, a. s.", "Hlavná 5, Košice", "35757442", "", "", "manual", "2026-10-02T08:00:00.000Z"]);
  // Gama: a Czech company from ARES; the DIČ is its VAT ID.
  await profile([3, "CZ", "Gama s.r.o.", "Vodičkova 1, Praha", "27082440", "CZ27082440", "", "ares", "2026-10-03T08:00:00.000Z"]);
  // Delta: the same IČO as Beta, a second company for one client: it gets no subject.
  await profile([4, "SK", "Delta s.r.o.", "Dunajská 2, Bratislava", "35757442", "", "", "rpo+ruz", "2026-10-04T08:00:00.000Z"]);

  // Alfa's subject: the directory's values differ from the profile, and it holds a manual correction.
  await client.query(
    `INSERT INTO subjects (country, ico, vat_id, legal_name, former_names_json, dic, address, register_status,
       sources_json, manual_fields_json, findings_json, linked_company_id, verified_at, last_seen_at, created_at)
     VALUES ('SK', '31333532', NULL, 'Alfa Holding s.r.o.', '["Alfa Trade, s.r.o."]', '2020311399', 'Stará 9',
       'active', $1, '["vatGroupId"]', $2, 1, '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    [
      JSON.stringify({ formerNames: "register", registerStatus: "register", legalName: "register", dic: "register", address: "register", vatGroupId: "manual" }),
      JSON.stringify([
        { field: "legalName", kind: "profile-disagrees", value: "Alfa Holding s.r.o.", at: "2026-10-16T00:00:00.000Z" },
        { field: "dic", kind: "register-disagrees", value: "2020311335", at: "2026-10-16T00:00:00.000Z" },
      ]),
    ],
  );
  // An unrelated subject, which carried a profile finding and a "profile" source from the old link.
  await client.query(
    `INSERT INTO subjects (country, ico, legal_name, dic, register_status, sources_json, manual_fields_json, findings_json,
       last_seen_at, created_at)
     VALUES ('SK', '11111111', 'Omega s.r.o.', '2020000111', 'active', $1, '[]', $2, '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z')`,
    [
      JSON.stringify({ legalName: "profile", dic: "register" }),
      JSON.stringify([{ field: "legalName", kind: "profile-disagrees", value: "Omega s.r.o.", at: "2026-10-16T00:00:00.000Z" }]),
    ],
  );
  // A subject still linked to a company that has no profile: the link was never the profile's.
  await client.query(
    `INSERT INTO subjects (country, ico, legal_name, register_status, last_seen_at, created_at, linked_company_id)
     VALUES ('SK', '44444444', 'Stray s.r.o.', 'active', '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z', 5)`,
  );
}

test("each profile becomes its company's subject, existing or new, and getCompanyProfile reads the same values", async () => {
  const client = new PGlite();
  clients.push(client);
  await migrate(drizzle(client), { migrationsFolder: await migrationsBefore(DATA_MIGRATION) });
  await seedBeforeMigration(client);
  const before = await rows(client, "SELECT * FROM company_profiles ORDER BY company_id");

  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  setDbForTests(drizzle(client, { schema }) as unknown as Db);

  for (const row of before) {
    const companyId = Number(row.company_id);
    if (companyId === 4) {
      continue;
    }
    assert.deepEqual(await getCompanyProfile(companyId), {
      companyId,
      country: row.country,
      legalName: row.legal_name,
      address: row.address,
      ico: row.ico,
      dic: row.dic,
      icDph: row.ic_dph,
      registerSource: row.register_source,
      savedAt: row.saved_at,
    }, `company ${companyId} reads its profile as before`);
  }
  assert.equal(await getCompanyProfile(4), null, "the second company with the IČO has no subject, so no profile");
  assert.equal(await getCompanyProfile(5), null, "a link with no profile behind it is not a profile");
});

test("an existing subject is linked and takes the profile's values, with the provenance a lookup or typing gives", async () => {
  const client = new PGlite();
  clients.push(client);
  await migrate(drizzle(client), { migrationsFolder: await migrationsBefore(DATA_MIGRATION) });
  await seedBeforeMigration(client);
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

  const alfa = await one(client, "SELECT * FROM subjects WHERE country = 'SK' AND ico = '31333532'");
  assert.equal(alfa.linked_company_id, 1);
  assert.equal(alfa.legal_name, "Alfa s.r.o.", "the profile wins over the directory's value");
  assert.equal(alfa.dic, "2020311335");
  assert.equal(alfa.address, "Pod Hradom 1, Bratislava");
  assert.equal(alfa.ic_dph, "SK2020311335");
  assert.equal(alfa.vat_id, "SK2020311335");
  assert.equal(alfa.profile_register_source, "rpo+ruz+vies");
  assert.equal(alfa.profile_saved_at, "2026-10-01T08:00:00.000Z");
  assert.deepEqual(JSON.parse(String(alfa.sources_json)), {
    formerNames: "register",
    registerStatus: "register",
    legalName: "register",
    dic: "register",
    address: "register",
    icDph: "vies",
    vatGroupId: "manual",
  });
  assert.deepEqual(JSON.parse(String(alfa.manual_fields_json)), ["vatGroupId"], "a register value is not manual; her group is kept");
  assert.deepEqual(JSON.parse(String(alfa.former_names_json)), ["Alfa Trade, s.r.o."], "what the profile does not say is kept");
  assert.equal(alfa.verified_at, "2026-10-15T00:00:00.000Z");
  assert.deepEqual(
    JSON.parse(String(alfa.findings_json)).map((finding: { kind: string }) => finding.kind),
    ["register-disagrees"],
    "profile-disagrees is gone; the register finding stays",
  );
});

test("a profile without a subject gets one, linked, with her typing as manual", async () => {
  const client = new PGlite();
  clients.push(client);
  await migrate(drizzle(client), { migrationsFolder: await migrationsBefore(DATA_MIGRATION) });
  await seedBeforeMigration(client);
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

  const beta = await one(client, "SELECT * FROM subjects WHERE country = 'SK' AND ico = '35757442'");
  assert.equal(beta.linked_company_id, 2);
  assert.equal(beta.legal_name, "Beta, a. s.");
  assert.equal(beta.dic, null, "an empty DIČ is no value");
  assert.equal(beta.vat_id, null);
  assert.equal(beta.register_status, "unknown");
  assert.equal(beta.verified_at, null, "no register answered for it yet");
  assert.deepEqual(JSON.parse(String(beta.sources_json)), { legalName: "manual", address: "manual" });
  assert.deepEqual(JSON.parse(String(beta.manual_fields_json)).sort(), ["address", "legalName"]);
  assert.equal(beta.created_at, "2026-10-02T08:00:00.000Z");
  assert.equal(beta.last_seen_at, "2026-10-02T08:00:00.000Z");
});

test("a Czech profile's DIČ is its VAT ID, and an ARES value is the register's", async () => {
  const client = new PGlite();
  clients.push(client);
  await migrate(drizzle(client), { migrationsFolder: await migrationsBefore(DATA_MIGRATION) });
  await seedBeforeMigration(client);
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

  const gama = await one(client, "SELECT * FROM subjects WHERE country = 'CZ' AND ico = '27082440'");
  assert.equal(gama.linked_company_id, 3);
  assert.equal(gama.vat_id, "CZ27082440");
  assert.deepEqual(JSON.parse(String(gama.sources_json)), { legalName: "register", address: "register", dic: "register" });
  assert.deepEqual(JSON.parse(String(gama.manual_fields_json)), []);
});

test("profile-disagrees findings and the 'profile' source go; a link without a profile is dropped; the profile table goes", async () => {
  const client = new PGlite();
  clients.push(client);
  await migrate(drizzle(client), { migrationsFolder: await migrationsBefore(DATA_MIGRATION) });
  await seedBeforeMigration(client);
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

  const omega = await one(client, "SELECT * FROM subjects WHERE ico = '11111111'");
  assert.deepEqual(JSON.parse(String(omega.findings_json)), []);
  assert.deepEqual(JSON.parse(String(omega.sources_json)), { dic: "register" });

  const stray = await one(client, "SELECT * FROM subjects WHERE ico = '44444444'");
  assert.equal(stray.linked_company_id, null);

  const linked = await one(client, "SELECT count(*)::int AS count FROM subjects WHERE linked_company_id = 4");
  assert.equal(linked.count, 0);

  const tables = await rows(
    client,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'company_profiles'",
  );
  assert.equal(tables.length, 0, "company_profiles is dropped");

  const index = await rows(
    client,
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'subjects_linked_company_once'",
  );
  assert.equal(index.length, 1, "a company has at most one linked subject");
});

test("the migration runs on a database without profiles", async () => {
  const client = new PGlite();
  clients.push(client);
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  const count = await one(client, "SELECT count(*)::int AS count FROM subjects");
  assert.equal(count.count, 0);
});
