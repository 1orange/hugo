import { after, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { getSubject, getSubjectLinkedTo, insertSubject, updateSubject } from "../../../src/adapters/store/subjects.ts";
import { scheduleStaleOfficeClientChecks } from "../../../src/lib/subject-directory/schedule.ts";
import { MemorySubjectVerificationQueue } from "../../../src/adapters/job-queue/memory-subject-verification-queue.ts";
import { companies, events, subjects } from "../../../src/lib/db/schema.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { applyClientSheet } from "../../../src/lib/client-sheet/service.ts";
import { useSubjectVerificationQueue } from "../../../src/lib/subject-directory/queue.ts";
import { listSubjectDirectory } from "../../../src/lib/subject-directory/screen.ts";
import { FIXTURE_COMPANIES, FIXTURE_CSV, FIXTURE_PROFILES } from "../support/client-sheet-fixture.ts";
import { freshTestDb } from "../support/test-db.ts";

// The Adresár (0006/04): sheet clients with an IČO and no company are office clients; their
// register check is queued on the memory queue, which these tests read.

const FIRST = "2026-11-16T09:00:00.000Z";
const SECOND = "2026-11-16T10:00:00.000Z";
const DELTA_ICO = "36000001";
const NONE = { confirmedRows: [], tickedFields: [] };

let queue = new MemorySubjectVerificationQueue();

async function seed(): Promise<void> {
  await freshTestDb();
  queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);
  await getDb().insert(companies).values(FIXTURE_COMPANIES);
  for (const { companyId, ...profile } of FIXTURE_PROFILES) {
    await saveCompanyProfile(companyId, { ...profile, country: "SK" });
  }
}

after(() => {
  useSubjectVerificationQueue(null);
});

async function subjectWithIco(ico: string) {
  const [row] = await getDb()
    .select()
    .from(subjects)
    .where(and(eq(subjects.country, "SK"), eq(subjects.ico, ico)))
    .limit(1);
  assert.ok(row, `a subject holds ${ico}`);
  return getSubject(row.id);
}

test("an import creates the office client: keeper, cooperation and the sheet's values, and queues its register check", async () => {
  await seed();

  const result = await applyClientSheet(FIXTURE_CSV, NONE, FIRST);
  assert.equal(result.ok && result.applied.adresar, 1);

  const delta = await subjectWithIco(DELTA_ICO);
  assert.ok(delta);
  assert.equal(delta.linkedCompanyId, null, "no company in Hugo, so nothing is linked");
  assert.equal(delta.officeClient, true);
  assert.equal(delta.officeKeeper, "Katarína");
  assert.equal(delta.officeCooperation, "aktívna");
  assert.equal(delta.legalName, "Delta, s.r.o.");
  assert.equal(delta.address, "Mierová 3, Žilina");
  assert.equal(delta.dic, "2020000007");
  assert.equal(delta.icDph, null);
  assert.equal(delta.sources.legalName, "sheet");
  assert.equal(delta.sources.address, "sheet");
  assert.equal(delta.createdAt, FIRST);

  // Every client subject the import wrote is queued for the register check, the office client too.
  assert.ok(queue.clientJobs.has(delta.id), "the office client is queued");
  const companySubject = await getSubjectLinkedTo(1);
  assert.ok(companySubject && queue.clientJobs.has(companySubject.id), "a company's subject is queued as before");

  // Its activity is recorded without a company: it is not on any company's page.
  const logged = await getDb()
    .select()
    .from(events)
    .where(eq(events.type, "SubjectImportedFromClientSheet"))
    .orderBy(asc(events.id));
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.companyId, null);
  assert.equal(logged[0]!.actor, "user");
});

test("a company's subject carries the sheet's Vedie and Spolupráca, though it is not an office client", async () => {
  await seed();
  await applyClientSheet(FIXTURE_CSV, NONE, FIRST);

  const zeta = await getSubjectLinkedTo(5);
  assert.equal(zeta?.officeKeeper, "Eva");
  assert.equal(zeta?.officeCooperation, "aktívna");
  assert.equal(zeta?.officeClient, false, "a linked company is a client without the flag");
});

test("re-importing the same sheet changes nothing: no write, no event, nothing queued", async () => {
  await seed();
  await applyClientSheet(FIXTURE_CSV, NONE, FIRST);
  const subjectsBefore = await getDb().select().from(subjects).orderBy(asc(subjects.id));
  const eventsBefore = await getDb().select().from(events);

  queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);
  const again = await applyClientSheet(FIXTURE_CSV, NONE, SECOND);
  assert.deepEqual(again, { ok: true, applied: { companies: 0, adresar: 0, fields: 0 } });

  assert.deepEqual(await getDb().select().from(subjects).orderBy(asc(subjects.id)), subjectsBefore);
  assert.equal((await getDb().select().from(events)).length, eventsBefore.length);
  assert.equal(queue.clientJobs.size, 0, "a sheet that changes nothing queues nothing");
});

test("a later profile save with the IČO links the same subject and keeps the office data", async () => {
  await seed();
  await applyClientSheet(FIXTURE_CSV, NONE, FIRST);
  const before = await subjectWithIco(DELTA_ICO);
  assert.ok(before);

  // The office opens a Doklady folder for Delta and saves its profile: the subject is linked, not copied.
  await getDb().insert(companies).values({
    id: 6,
    driveFolderId: "folder-delta",
    name: "Doklady Delta, s.r.o.",
    groupName: "Katarína",
    archived: false,
    active: true,
  });
  await saveCompanyProfile(
    6,
    {
      country: "SK",
      legalName: "Delta, s.r.o.",
      address: "Mierová 3, Žilina",
      ico: DELTA_ICO,
      dic: "2020000007",
      icDph: "",
      registerSource: "manual",
      savedAt: SECOND,
    },
    ["legalName"],
  );

  const linked = await getSubjectLinkedTo(6);
  assert.ok(linked);
  assert.equal(linked.id, before.id, "the same subject, not a second one");
  assert.equal(linked.linkedCompanyId, 6);
  assert.equal(linked.officeClient, true, "the office-client status stays");
  assert.equal(linked.officeKeeper, "Katarína");
  assert.equal(linked.officeCooperation, "aktívna");
  assert.equal(linked.sources.legalName, "sheet", "a value the save did not change keeps its source");

  const rows = (await getDb().select().from(subjects).where(eq(subjects.ico, DELTA_ICO)));
  assert.equal(rows.length, 1);
});

test("viewing the Adresár queues the office clients whose register answer is stale, and no other subject", async () => {
  await seed();
  await applyClientSheet(FIXTURE_CSV, NONE, FIRST);
  await insertSubject({ country: "SK", ico: "44444444", vatId: null, legalName: "Kappa s.r.o.", now: FIRST });
  queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);

  // Delta has never been checked, so it is stale; Kappa is a counterparty, not a client.
  await scheduleStaleOfficeClientChecks();
  const delta = await subjectWithIco(DELTA_ICO);
  assert.ok(delta);
  assert.deepEqual([...queue.clientJobs.keys()], [delta.id]);

  // A register answer of today is not stale: nothing is queued for it.
  queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);
  await updateSubject(delta.id, { verifiedAt: new Date().toISOString() });
  await scheduleStaleOfficeClientChecks();
  assert.equal(queue.clientJobs.size, 0);
});

test("the client filter lists the office clients with the linked clients, and not a counterparty", async () => {
  await seed();
  await applyClientSheet(FIXTURE_CSV, NONE, FIRST);
  await insertSubject({ country: "SK", ico: "44444444", vatId: null, legalName: "Kappa s.r.o.", now: FIRST });

  const clients = await listSubjectDirectory("", 100, { clientsOnly: true });
  // Three linked clients (Alfa, Gama, Zeta: Beta is not confirmed by the sheet, so it has no profile) and the office client.
  const names = clients.rows.map((row) => row.name).sort();
  assert.deepEqual(names, ["Alfa s.r.o.", "Delta, s.r.o.", "Gama, a.s.", "Zeta s.r.o."]);
  assert.ok(!names.includes("Kappa s.r.o."), "a counterparty is not a client");
  assert.equal(clients.total, 4);

  const delta = clients.rows.find((row) => row.name === "Delta, s.r.o.");
  assert.deepEqual(delta?.client, { href: null }, "an office client has no company to link to");
  assert.equal(delta?.keeper, "Katarína");
  assert.equal(delta?.cooperation, "aktívna");

  const alfa = clients.rows.find((row) => row.name === "Alfa s.r.o.");
  assert.deepEqual(alfa?.client, { href: "/companies/1/activity" });
});
