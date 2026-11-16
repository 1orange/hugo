import { test } from "node:test";
import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { listCompanyProfiles, saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { toSubject } from "../../../src/adapters/store/subjects.ts";
import { companies, events, subjects } from "../../../src/lib/db/schema.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { applyClientSheet, previewClientSheet } from "../../../src/lib/client-sheet/service.ts";
import { formatActivityEntry } from "../../../src/modules/activity-log.ts";
import { tickKey } from "../../../src/modules/client-sheet.ts";
import { FIXTURE_COMPANIES, FIXTURE_CSV, FIXTURE_PROFILES } from "../support/client-sheet-fixture.ts";
import { freshTestDb } from "../support/test-db.ts";

const FIRST = "2026-11-16T09:00:00.000Z";
const SECOND = "2026-11-16T10:00:00.000Z";

async function seed(): Promise<void> {
  await freshTestDb();
  const db = getDb();
  await db.insert(companies).values(FIXTURE_COMPANIES);
  // Saved as the app saves them: each profile is its client's Adresár subject.
  for (const { companyId, ...profile } of FIXTURE_PROFILES) {
    await saveCompanyProfile(companyId, { ...profile, country: "SK" });
  }
}

async function importEvents() {
  return getDb()
    .select()
    .from(events)
    .where(eq(events.type, "ImportedFromClientSheet"))
    .orderBy(asc(events.id));
}

async function profileOf(companyId: number) {
  return (await listCompanyProfiles()).find((profile) => profile.companyId === companyId) ?? null;
}

test("the preview writes nothing: no profile changes and no activity", async () => {
  await seed();
  const before = await listCompanyProfiles();

  const preview = await previewClientSheet(FIXTURE_CSV);
  assert.equal(preview.ok, true);
  if (!preview.ok) {
    return;
  }
  assert.equal(preview.plan.counts.new, 1);
  assert.equal(preview.plan.counts.changed, 2);
  assert.equal(preview.plan.counts.unmatched, 1);

  assert.deepEqual(await listCompanyProfiles(), before);
  assert.equal((await importEvents()).length, 0);
});

test("a confirmed write fills what the sheet has, keeps hand-saved values, and logs each company", async () => {
  await seed();

  const first = await applyClientSheet(FIXTURE_CSV, { confirmedRows: [], tickedFields: [] }, FIRST);
  assert.deepEqual(first, { ok: true, applied: { companies: 2, fields: 5 } });

  // Alfa's hand-saved address stays; only her empty IČ DPH is filled.
  const alfa = await profileOf(1);
  assert.equal(alfa?.address, "Pod Hradom 1, Bratislava");
  assert.equal(alfa?.icDph, "SK2020000001");
  assert.equal(alfa?.legalName, "Alfa s.r.o.");
  assert.equal(alfa?.registerSource, "client-sheet");
  assert.equal(alfa?.savedAt, FIRST);

  // Gama had only an IČO: the rest comes from the sheet.
  const gama = await profileOf(3);
  assert.equal(gama?.legalName, "Gama, a.s.");
  assert.equal(gama?.address, "Mlynská 1, Trnava");
  assert.equal(gama?.dic, "2020000003");
  assert.equal(gama?.icDph, "SK2020000003");

  // Beta is a guess nobody confirmed, Epsilon is malformed, Zeta matches exactly, Neznáma is unmatched.
  assert.equal(await profileOf(2), null);
  assert.equal((await profileOf(4)), null);
  const zeta = await profileOf(5);
  assert.equal(zeta?.registerSource, "manual", "an unchanged profile is not touched");
  assert.equal(zeta?.savedAt, "2026-10-03T08:00:00.000Z");

  const logged = await importEvents();
  assert.deepEqual(logged.map((event) => event.companyId), [1, 3]);
  assert.ok(logged.every((event) => event.actor === "user"), "she confirmed these writes, so they are hers");
});

test("a second confirmed write with a confirmed guess and a ticked change writes exactly those", async () => {
  await seed();
  await applyClientSheet(FIXTURE_CSV, { confirmedRows: [], tickedFields: [] }, FIRST);

  const second = await applyClientSheet(
    FIXTURE_CSV,
    { confirmedRows: [2], tickedFields: [tickKey(1, "address")] },
    SECOND,
  );
  // Gama is complete now, so only Alfa's ticked address and the confirmed Beta are left to write.
  assert.deepEqual(second, { ok: true, applied: { companies: 2, fields: 6 } });

  assert.equal((await profileOf(1))?.address, "Pod Hradom 2, Bratislava", "the ticked change replaces her value");
  assert.equal((await profileOf(1))?.legalName, "Alfa s.r.o.", "the rest of her profile is kept");

  const beta = await profileOf(2);
  assert.equal(beta?.ico, "87654326");
  assert.equal(beta?.legalName, "Beta Štúdio s.r.o.");
  assert.equal(beta?.registerSource, "client-sheet");

  const logged = await importEvents();
  assert.equal(logged.length, 4);
  const overwrite = logged.find((event) => event.companyId === 1 && event.timestamp === SECOND);
  assert.ok(overwrite);
  const entry = formatActivityEntry({
    id: overwrite!.id,
    timestamp: overwrite!.timestamp,
    companyId: overwrite!.companyId,
    actor: overwrite!.actor,
    type: overwrite!.type,
    payloadJson: overwrite!.payloadJson,
  });
  assert.equal(entry.typeLabel, "Profil firmy doplnený z klientskeho hárku");
  assert.match(entry.summary, /prepísané ručne uložené: Sídlo/);
});

test("once the sheet and the profiles agree, a confirm writes nothing and logs nothing", async () => {
  await seed();
  await applyClientSheet(FIXTURE_CSV, { confirmedRows: [2], tickedFields: [tickKey(1, "address")] }, FIRST);
  const eventsBefore = (await importEvents()).length;

  const again = await applyClientSheet(
    FIXTURE_CSV,
    { confirmedRows: [2], tickedFields: [tickKey(1, "address")] },
    SECOND,
  );
  assert.deepEqual(again, { ok: true, applied: { companies: 0, fields: 0 } });
  assert.equal((await importEvents()).length, eventsBefore);
});

test("a refused sheet writes nothing, and the reason is in Slovak", async () => {
  await seed();
  const before = await listCompanyProfiles();

  const result = await applyClientSheet("Klient,IČO\nAlfa,12345679\n", { confirmedRows: [], tickedFields: [] }, FIRST);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /chýbajú stĺpce/);
  assert.deepEqual(await listCompanyProfiles(), before);
  assert.equal((await importEvents()).length, 0);
});

/** The Adresár entry of a company: the subject linked to it, as the Adresár reads it. */
async function adresarEntryOf(companyId: number) {
  const [row] = await getDb().select().from(subjects).where(eq(subjects.linkedCompanyId, companyId)).limit(1);
  return row ? toSubject(row) : null;
}

test("a confirmed import writes the Adresár entry: linked to the company, values from the sheet, source sheet", async () => {
  await seed();

  // Beta is a name guess: it is written only with her confirmation, and gets a new subject.
  const result = await applyClientSheet(FIXTURE_CSV, { confirmedRows: [2], tickedFields: [] }, FIRST);
  assert.equal(result.ok, true);

  const beta = await adresarEntryOf(2);
  assert.ok(beta, "a new subject is created for the company and linked to it");
  assert.equal(beta.ico, "87654326");
  assert.equal(beta.country, "SK");
  assert.equal(beta.linkedCompanyId, 2);
  assert.equal(beta.legalName, "Beta Štúdio s.r.o.");
  assert.equal(beta.address, "Hlavná 5, Košice");
  assert.equal(beta.dic, "2020000002");
  assert.deepEqual(beta.sources, { legalName: "sheet", address: "sheet", dic: "sheet" });
  assert.deepEqual(beta.manualFields, []);

  // Gama had only an IČO: its existing subject is filled, every value it gained carries the sheet's source.
  const gama = await adresarEntryOf(3);
  assert.ok(gama);
  assert.equal(gama.ico, "50000004");
  assert.equal(gama.legalName, "Gama, a.s.");
  assert.equal(gama.icDph, "SK2020000003");
  assert.deepEqual(gama.sources, { legalName: "sheet", address: "sheet", dic: "sheet", icDph: "sheet" });
  assert.deepEqual(gama.manualFields, []);

  // Alfa's address was hand-saved and is not ticked: it keeps its manual source; the empty IČ DPH is filled as sheet.
  const alfa = await adresarEntryOf(1);
  assert.ok(alfa);
  assert.equal(alfa.address, "Pod Hradom 1, Bratislava");
  assert.equal(alfa.sources.address, "manual");
  assert.equal(alfa.sources.icDph, "sheet");
  assert.equal(alfa.sources.legalName, "manual", "a value the sheet agreed with and did not write keeps its source");
  assert.deepEqual([...alfa.manualFields].sort(), ["address", "dic", "legalName"]);

  // Zeta matches the sheet exactly: nothing is written, so its values keep the source they had.
  const zeta = await adresarEntryOf(5);
  assert.equal(zeta?.sources.legalName, "manual");
  assert.equal(zeta?.sources.icDph, "manual");
});

test("a manual field is replaced only when ticked, and then carries the sheet's source and leaves the manual list", async () => {
  await seed();

  // Not ticked: her address stays, still manual and still in the manual list.
  await applyClientSheet(FIXTURE_CSV, { confirmedRows: [], tickedFields: [] }, FIRST);
  const untouched = await adresarEntryOf(1);
  assert.equal(untouched?.address, "Pod Hradom 1, Bratislava");
  assert.equal(untouched?.sources.address, "manual");
  assert.ok(untouched?.manualFields.includes("address"));

  // Ticked: the sheet's value replaces hers, its source is sheet, and it is no longer manual.
  const ticked = await applyClientSheet(FIXTURE_CSV, { confirmedRows: [], tickedFields: [tickKey(1, "address")] }, SECOND);
  assert.deepEqual(ticked, { ok: true, applied: { companies: 1, fields: 1 } });

  const replaced = await adresarEntryOf(1);
  assert.equal(replaced?.address, "Pod Hradom 2, Bratislava");
  assert.equal(replaced?.sources.address, "sheet");
  assert.ok(!replaced?.manualFields.includes("address"), "a field the sheet wrote is no longer hand-saved");
  assert.deepEqual([...(replaced?.manualFields ?? [])].sort(), ["dic", "legalName"], "her other hand-saved fields stay manual");
  assert.equal(replaced?.sources.legalName, "manual");
});
