import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import type { CompanyRegister } from "../../../src/adapters/company-register/port.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import type { VatRegister } from "../../../src/adapters/vat-register/port.ts";
import { getCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { events, companies, subjects } from "../../../src/lib/db/schema.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import {
  loadCompanyProfileView,
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

test("a Slovak company without DIČ or IČ DPH saves; a malformed IČ DPH is still refused", async () => {
  await freshTestDb();
  await getDb().insert(companies).values({ id: 3, driveFolderId: "co-3", name: "Delta s.r.o.", active: true });
  const base = {
    country: "SK" as const,
    legalName: "Delta s.r.o.",
    address: "Hlavná 1, Bratislava",
    ico: "31333532",
    registerSource: "ruz",
  };

  const saved = await saveCompanyProfileForUser(3, { ...base, dic: "", icDph: "" }, "2026-11-12T12:00:00.000Z");
  assert.equal(saved.ok, true);
  const profile = await getCompanyProfile(3);
  assert.equal(profile?.dic, "");
  assert.equal(profile?.icDph, "");

  const malformed = await saveCompanyProfileForUser(3, { ...base, dic: "", icDph: "SK123" }, "2026-11-12T12:01:00.000Z");
  assert.equal(malformed.ok, false);

  const withVat = await saveCompanyProfileForUser(
    3,
    { ...base, dic: "2020311335", icDph: "sk2020311335" },
    "2026-11-12T12:02:00.000Z",
  );
  assert.equal(withVat.ok, true);
  assert.equal((await getCompanyProfile(3))?.icDph, "SK2020311335");
});

test("a Konto-prefixed folder is searched, shown and prefilled without the prefix; the stored name keeps it", async () => {
  await freshTestDb();

  const db = getDb();
  await db.insert(companies)
    .values({ id: 1, driveFolderId: "co-1", name: "Konto Beta s.r.o.", active: true });

  const queries: string[] = [];
  const register: CompanyRegister = {
    async searchByName(name) {
      queries.push(name);
      return [];
    },
    async lookupByIco() {
      return null;
    },
  };

  // The profile form prefills its search with the empty query: the folder's display name.
  const search = await searchCompanyRegister(1, "", "SK", { register });
  assert.equal(search.ok, true);
  assert.deepEqual(queries, ["Beta s.r.o."]);
  if (search.ok) {
    assert.equal(search.companyName, "Beta s.r.o.");
  }

  const view = await loadCompanyProfileView(1);
  assert.equal(view?.companyName, "Beta s.r.o.");

  const rows = await listCompanySummaries();
  assert.equal(rows[0]?.name, "Beta s.r.o.");

  const [stored] = await db.select().from(companies).where(eq(companies.id, 1));
  assert.equal(stored?.name, "Konto Beta s.r.o.");
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

// The profile is its Adresár subject (ADR 0022, amended 2026-11-16): one record, with provenance per field.
test("a saved profile is the subject, with the lookup's values from the register and her typing manual", async () => {
  await freshTestDb();
  await getDb().insert(companies).values({ id: 1, driveFolderId: "co-1", name: "Beta s.r.o.", active: true });
  const base = {
    country: "SK" as const,
    legalName: "Beta, a. s.",
    address: "Hlavná 1, Košice",
    ico: "31333532",
    dic: "2020311335",
    icDph: "SK2020311335",
    registerSource: "rpo+ruz+vies",
  };

  // The lookup filled every field: all of them are the register's, and VIES's for the IČ DPH.
  assert.equal((await saveCompanyProfileForUser(1, base, "2026-11-16T09:00:00.000Z")).ok, true);
  let [subject] = await getDb().select().from(subjects).where(eq(subjects.ico, "31333532"));
  assert.equal(subject?.linkedCompanyId, 1);
  assert.deepEqual(JSON.parse(subject!.sourcesJson), { legalName: "register", address: "register", dic: "register", icDph: "vies" });
  assert.deepEqual(JSON.parse(subject!.manualFieldsJson), []);

  // She types the address by hand: that value is hers, the rest keep the register's source.
  const typed = await saveCompanyProfileForUser(
    1,
    { ...base, address: "Hlavná 2, Košice", registerSource: "", typedFields: ["address"] },
    "2026-11-16T10:00:00.000Z",
  );
  assert.equal(typed.ok, true);
  [subject] = await getDb().select().from(subjects).where(eq(subjects.ico, "31333532"));
  assert.equal(subject?.address, "Hlavná 2, Košice");
  assert.equal(subject?.sourcesJson.includes('"address":"manual"'), true);
  assert.deepEqual(JSON.parse(subject!.manualFieldsJson), ["address"]);
  assert.equal(subject?.profileSavedAt, "2026-11-16T10:00:00.000Z");

  // Saving the form again with nothing changed leaves every source as it was.
  assert.equal(
    (await saveCompanyProfileForUser(1, { ...base, address: "Hlavná 2, Košice", registerSource: "" }, "2026-11-16T11:00:00.000Z")).ok,
    true,
  );
  [subject] = await getDb().select().from(subjects).where(eq(subjects.ico, "31333532"));
  assert.deepEqual(JSON.parse(subject!.sourcesJson), { legalName: "register", address: "manual", dic: "register", icDph: "vies" });
  assert.deepEqual(JSON.parse(subject!.manualFieldsJson), ["address"]);
  assert.equal((await getCompanyProfile(1))?.address, "Hlavná 2, Košice");
});

test("an IČO that another company's profile holds is refused, and nothing is written", async () => {
  await freshTestDb();
  await getDb().insert(companies).values([
    { id: 1, driveFolderId: "co-1", name: "Beta s.r.o.", active: true },
    { id: 2, driveFolderId: "co-2", name: "Gamma s.r.o.", active: true },
  ]);
  const base = { country: "SK" as const, legalName: "Beta s.r.o.", address: "", dic: "", icDph: "", ico: "31333532", registerSource: "manual" };
  assert.equal((await saveCompanyProfileForUser(1, base, "2026-11-16T09:00:00.000Z")).ok, true);

  const refused = await saveCompanyProfileForUser(2, { ...base, legalName: "Gamma s.r.o." }, "2026-11-16T09:01:00.000Z");
  assert.deepEqual(refused, { ok: false, message: "Toto IČO už má v Hugu profil inej firmy." });
  assert.equal(await getCompanyProfile(2), null);
  assert.equal((await getCompanyProfile(1))?.legalName, "Beta s.r.o.");
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
