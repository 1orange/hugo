import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { getCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { events, companies } from "../../../src/lib/db/schema.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import {
  lookupCompanyRegister,
  saveCompanyProfileForUser,
  searchCompanyRegister,
} from "../../../src/lib/company-profile/service.ts";
import { listCompanySummaries, summariseChaseList } from "../../../src/lib/sweep/views.ts";
import { formatActivityEntry } from "../../../src/modules/activity-log.ts";
import { freshTestDb } from "../support/test-db.ts";

test("profile save emits CompanyProfileSaved and clears chase marker", async () => {
  await freshTestDb();

  const db = getDb();
  await db.insert(companies)
    .values({ id: 1, driveFolderId: "co-1", name: "Beta s.r.o.", active: true });

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

  const saved = await saveCompanyProfileForUser(
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

  const profile = await getCompanyProfile(1);
  assert.ok(profile);
  assert.equal(profile.icDph, "SK1234567890");
  assert.equal(profile.registerSource, "rpo+ruz");

  const event = (await db.select().from(events).where(eq(events.type, "CompanyProfileSaved")).limit(1))[0];
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

  const rows = await listCompanySummaries();
  assert.equal(rows[0]?.profileMissing, false);
  assert.equal(summariseChaseList(rows).withoutProfile, 0);
});

test("czech profile saves without IČ DPH and uses ARES source", async () => {
  await freshTestDb();

  const db = getDb();
  await db.insert(companies)
    .values({ id: 2, driveFolderId: "co-2", name: "Gamma s.r.o.", active: true });

  const register = new FakeCompanyRegister();
  const lookup = await lookupCompanyRegister("87654321", "CZ", { register });
  assert.equal(lookup.ok, true);
  if (!lookup.ok) {
    return;
  }

  const saved = await saveCompanyProfileForUser(
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

  const profile = await getCompanyProfile(2);
  assert.ok(profile);
  assert.equal(profile.country, "CZ");
  assert.equal(profile.icDph, "");
  assert.equal(profile.registerSource, "ares");
});

