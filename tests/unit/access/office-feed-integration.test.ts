import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { upsertCompany } from "../../../src/adapters/store/companies.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { appendGlobalUserEvent, appendUserEvent } from "../../../src/adapters/store/events.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { events, subjects } from "../../../src/lib/db/schema.ts";
import { buildGlobalActivityView } from "../../../src/lib/activity-log/view.ts";
import { loadSubjectDetail } from "../../../src/lib/subject-directory/screen.ts";
import { freshTestDb } from "../support/test-db.ts";

const TS = "2026-11-20T08:00:00.000Z";
const ALFA = "Alfa s.r.o.";
const BETA = "Beta a.s.";

/**
 * Two companies, one event each, one office event, and one company-less file
 * event (a sweep could not place the file). Eva sees Alfa; Jana sees Beta.
 */
async function seed(): Promise<{ alfa: number; beta: number }> {
  const alfa = (await upsertCompany("drive-alfa", ALFA)).id;
  const beta = (await upsertCompany("drive-beta", BETA)).id;
  await appendUserEvent(TS, alfa, "MonthClosed", { monthKey: "2026_10" });
  await appendUserEvent(TS, beta, "Confirmed", { driveFileId: "beta-invoice" });
  await appendGlobalUserEvent(TS, "AutoAdvanceChanged", { next: true });
  await getDb().insert(events).values({
    timestamp: TS,
    companyId: null,
    actor: "system",
    type: "FileRenamedInDrive",
    payloadJson: JSON.stringify({ driveFileId: "orphan", previousName: "Tajne-zmluvy.pdf", newName: "x.pdf" }),
  });
  return { alfa, beta };
}

test("the office feed shows her companies' events and the office's own, never another company's", async () => {
  await freshTestDb();
  const { alfa, beta } = await seed();

  const eva = await buildGlobalActivityView([alfa]);
  assert.deepEqual(eva.entries.map((entry) => entry.type).sort(), ["AutoAdvanceChanged", "MonthClosed"]);
  assert.deepEqual(Object.keys(eva.companyNames), [String(alfa)], "only her company is named");
  assert.equal(eva.companyNames[alfa], "Alfa s.r.o.");

  const jana = await buildGlobalActivityView([beta]);
  assert.deepEqual(jana.entries.map((entry) => entry.type).sort(), ["AutoAdvanceChanged", "Confirmed"]);

  assert.ok(!JSON.stringify(eva).includes(BETA), "Beta's name is not in Eva's feed");
  assert.ok(!JSON.stringify(eva).includes("beta-invoice"), "Beta's document is not in Eva's feed");
  assert.ok(!JSON.stringify(eva).includes("Tajne-zmluvy"), "a company-less file event is not in anyone's feed");
  assert.ok(!JSON.stringify(jana).includes("Tajne-zmluvy"));
});

test("with no visible company, the feed is the office's own events only", async () => {
  await freshTestDb();
  await seed();

  const nobody = await buildGlobalActivityView([]);
  assert.deepEqual(nobody.entries.map((entry) => entry.type), ["AutoAdvanceChanged"]);
  assert.deepEqual(nobody.companyNames, {});
});

test("the Adresár subject's client company is named only to a person who may see it", async () => {
  await freshTestDb();
  const { alfa, beta } = await seed();
  await saveCompanyProfile(beta, {
    country: "SK",
    legalName: "Beta a.s.",
    address: "Bratislava",
    ico: "35757442",
    dic: "2020357574",
    icDph: "",
    registerSource: "fake",
    savedAt: TS,
  });
  const [subject] = await getDb().select().from(subjects).where(eq(subjects.linkedCompanyId, beta)).limit(1);
  assert.ok(subject, "the profile links a subject to Beta");

  const jana = await loadSubjectDetail(subject!.id, new Set([beta]));
  assert.equal(jana?.linkedCompany?.id, beta, "the client company is shown to the person who sees it");

  const eva = await loadSubjectDetail(subject!.id, new Set([alfa]));
  assert.ok(eva, "the office-wide subject is still shown");
  assert.equal(eva.linkedCompany, null, "its client company's name and page are not");
  assert.ok(!JSON.stringify(eva).includes(`/companies/${beta}/`));
});
