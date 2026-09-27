import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { getCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { events, companies } from "../../../src/lib/db/schema.ts";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import {
  lookupCompanyRegister,
  saveCompanyProfileForUser,
  searchCompanyRegister,
} from "../../../src/lib/company-profile/service.ts";
import { listCompanySummaries, summariseChaseList } from "../../../src/lib/sweep/views.ts";
import { formatActivityEntry } from "../../../src/modules/activity-log.ts";

function tempDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hugo-profile-")), "test.db");
}

test("profile save emits CompanyProfileSaved and clears chase marker", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: "co-1", name: "Beta s.r.o.", active: true })
    .run();

  const register = new FakeCompanyRegister();
  const search = await searchCompanyRegister(1, "Beta", "SK", { register });
  assert.equal(search.ok, true);
  if (!search.ok) {
    return;
  }
  assert.ok(search.hits.length > 0);

  const lookup = await lookupCompanyRegister(search.hits[0]!.ico, "SK", { register });
  assert.equal(lookup.ok, true);
  if (!lookup.ok) {
    return;
  }

  const saved = saveCompanyProfileForUser(
    1,
    {
      country: "SK",
      legalName: lookup.lookup.legalName,
      address: lookup.lookup.address,
      ico: lookup.lookup.ico,
      dic: lookup.lookup.dic,
      icDph: "SK1234567890",
      registerSource: lookup.registerSource,
    },
    "2026-09-27T12:00:00.000Z",
  );
  assert.equal(saved.ok, true);

  const profile = getCompanyProfile(1);
  assert.ok(profile);
  assert.equal(profile.icDph, "SK1234567890");
  assert.equal(profile.registerSource, "rpo+ruz");

  const event = db.select().from(events).where(eq(events.type, "CompanyProfileSaved")).get();
  assert.ok(event);
  const formatted = formatActivityEntry({
    id: event!.id,
    timestamp: event!.timestamp,
    companyId: 1,
    actor: "user",
    type: "CompanyProfileSaved",
    payloadJson: event!.payloadJson,
  });
  assert.match(formatted.summary, /Beta s\.r\.o\./);

  const rows = listCompanySummaries();
  assert.equal(rows[0]?.profileMissing, false);
  assert.equal(summariseChaseList(rows).withoutProfile, 0);
});

test("czech profile saves without IČ DPH and uses ARES source", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 2, driveFolderId: "co-2", name: "Gamma s.r.o.", active: true })
    .run();

  const register = new FakeCompanyRegister();
  const lookup = await lookupCompanyRegister("87654321", "CZ", { register });
  assert.equal(lookup.ok, true);
  if (!lookup.ok) {
    return;
  }

  const saved = saveCompanyProfileForUser(
    2,
    {
      country: "CZ",
      legalName: lookup.lookup.legalName,
      address: lookup.lookup.address,
      ico: lookup.lookup.ico,
      dic: lookup.lookup.dic,
      icDph: "",
      registerSource: lookup.registerSource,
    },
    "2026-09-27T12:00:00.000Z",
  );
  assert.equal(saved.ok, true);

  const profile = getCompanyProfile(2);
  assert.ok(profile);
  assert.equal(profile.country, "CZ");
  assert.equal(profile.icDph, "");
  assert.equal(profile.registerSource, "ares");
});
