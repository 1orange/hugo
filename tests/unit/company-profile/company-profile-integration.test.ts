import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import type { CompanyRegister } from "../../../src/adapters/company-register/port.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import type { VatRegister } from "../../../src/adapters/vat-register/port.ts";
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

  const lookup = await lookupCompanyRegister(search.hits[0]!.ico, "SK", {
    register,
    vatRegister: new FakeVatRegister(),
  });
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

async function withDb(): Promise<void> {
  await freshTestDb();
}

// Beta s.r.o.'s DIČ in the fake register is 2020311335.
test("a Slovak lookup fills IČ DPH with SK + DIČ when VIES registers it to the same name", async () => {
  await withDb();
  const lookup = await lookupCompanyRegister("31333532", "SK", {
    register: new FakeCompanyRegister(),
    vatRegister: new FakeVatRegister({ SK2020311335: "Beta, s. r. o." }),
  });
  assert.ok(lookup.ok);
  assert.equal(lookup.icDph, "SK2020311335");
  assert.equal(lookup.registerSource, "rpo+ruz+vies");
  assert.match(lookup.icDphNote ?? "", /overené vo VIES/);
});

test("IČ DPH stays empty when VIES does not register SK + DIČ — a VAT group member", async () => {
  await withDb();
  const lookup = await lookupCompanyRegister("31333532", "SK", {
    register: new FakeCompanyRegister(),
    vatRegister: new FakeVatRegister(),
  });
  assert.ok(lookup.ok);
  assert.equal(lookup.icDph, null);
  assert.equal(lookup.registerSource, "rpo+ruz");
  assert.match(lookup.icDphNote ?? "", /skupine DPH/);
});

test("IČ DPH stays empty when VIES registers the number to another name", async () => {
  await withDb();
  const lookup = await lookupCompanyRegister("31333532", "SK", {
    register: new FakeCompanyRegister(),
    vatRegister: new FakeVatRegister({ SK2020311335: "Group registration - This VAT ID corresponds to a Group of Taxpayers" }),
  });
  assert.ok(lookup.ok);
  assert.equal(lookup.icDph, null);
  assert.match(lookup.icDphNote ?? "", /iným názvom/);
});

test("a VIES outage leaves IČ DPH to her, and the lookup still succeeds", async () => {
  await withDb();
  const down: VatRegister = {
    async check() {
      throw new Error("VIES: MS_UNAVAILABLE");
    },
  };
  const lookup = await lookupCompanyRegister("31333532", "SK", { register: new FakeCompanyRegister(), vatRegister: down });
  assert.ok(lookup.ok);
  assert.equal(lookup.icDph, null);
  assert.match(lookup.icDphNote ?? "", /VIES teraz neodpovedá/);
});

test("a register that fails says so instead of throwing", async () => {
  await withDb();
  const failing: CompanyRegister = {
    async searchByName() {
      throw new Error("RPO search failed: HTTP 400");
    },
    async lookupByIco() {
      throw new Error("RÚZ lookup failed: HTTP 403");
    },
  };
  const lookup = await lookupCompanyRegister("45891761", "SK", { register: failing, vatRegister: new FakeVatRegister() });
  assert.deepEqual(lookup.ok, false);
  assert.match(lookup.ok ? "" : lookup.message, /RÚZ teraz neodpovedá \(RÚZ lookup failed: HTTP 403\)/);
});
