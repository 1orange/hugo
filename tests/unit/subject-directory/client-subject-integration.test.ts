import { after, test } from "node:test";
import assert from "node:assert/strict";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { MemorySubjectVerificationQueue } from "../../../src/adapters/job-queue/memory-subject-verification-queue.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { getSubject, getSubjectLinkedTo, updateSubject, type SubjectSource } from "../../../src/adapters/store/subjects.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies } from "../../../src/lib/db/schema.ts";
import { saveCompanyProfileForUser } from "../../../src/lib/company-profile/service.ts";
import { ClientRegisterUnavailable, verifyClientSubject } from "../../../src/lib/subject-directory/client-subject.ts";
import { restoreRegisterValueByHand, correctSubjectByHand } from "../../../src/lib/subject-directory/correction.ts";
import { useSubjectVerificationQueue } from "../../../src/lib/subject-directory/queue.ts";
import {
  queueClientSubjectCheck,
  scheduleClientSubjectCheck,
  scheduleStaleClientSubjectCheck,
} from "../../../src/lib/subject-directory/schedule.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import type { DirectoryDeps } from "../../../src/lib/subject-directory/service.ts";
import { loadProfileIdentity, loadSubjectDetail } from "../../../src/lib/subject-directory/screen.ts";
import { freshTestDb } from "../support/test-db.ts";

const START = "2026-11-16T09:00:00.000Z";
const ICO = "31333532";
const REGISTERED = {
  country: "SK" as const,
  ico: ICO,
  legalName: "Alfa s.r.o.",
  address: "Bratislava, Pribinova 25",
  dic: "2020311335",
  status: "active" as const,
};
const BASE = {
  country: "SK" as const,
  legalName: "Alfa s.r.o.",
  address: "Bratislava, Pribinova 25",
  ico: ICO,
  dic: "2020311335",
  icDph: "",
  registerSource: "",
};

const queue = new MemorySubjectVerificationQueue();
useSubjectVerificationQueue(queue);
after(() => useSubjectVerificationQueue(null));

function depsFor(register: FakeCompanyRegister): DirectoryDeps {
  return {
    register,
    vat: new FakeVatRegister(),
    lock: new InProcessLookupLock(),
    limiter: createLookupRateLimiter({ perMinute: 1000 }),
    refreshDays: 30,
    now: () => START,
    waitMs: 5000,
  };
}

async function seedClient(): Promise<number> {
  await freshTestDb();
  queue.clientJobs.clear();
  await getDb().insert(companies).values({ id: 1, driveFolderId: "alfa-folder", name: "Doklady Alfa s.r.o.", active: true });
  const saved = await saveCompanyProfileForUser(1, { ...BASE, typedFields: ["legalName", "address", "dic"] }, START);
  assert.equal(saved.ok, true);
  const subject = await getSubjectLinkedTo(1);
  assert.ok(subject, "the profile is the company's subject");
  return subject.id;
}

async function stateOf(field: string) {
  const identity = await loadProfileIdentity(1);
  assert.ok(identity, "the company has a subject");
  return identity.rows.find((row) => row.field === field)!;
}

test("a profile save queues the client's subject for the register and VIES check", async () => {
  const subjectId = await seedClient();
  assert.deepEqual([...queue.clientJobs.keys()], [subjectId]);
});

test("save, then check: the typed values the register confirms are overené", async () => {
  const subjectId = await seedClient();
  const register = new FakeCompanyRegister({ lookups: [REGISTERED] });

  await verifyClientSubject(subjectId, depsFor(register));

  assert.equal(register.lookupCalls.length, 1, "one lookup for the IČO");
  for (const field of ["legalName", "address", "dic", "ico"]) {
    assert.equal((await stateOf(field)).state, "overene", field);
  }
  const subject = await getSubject(subjectId);
  assert.equal(subject!.sources.legalName, "register", "a typed value the register says the same as is the register's now");
  assert.deepEqual(subject!.manualFields, []);
  assert.equal(subject!.registerStatus, "active");
});

test("a hand edit that differs from the register is upravené ručne, with the register's value beside it", async () => {
  const subjectId = await seedClient();
  const register = new FakeCompanyRegister({ lookups: [REGISTERED] });
  await verifyClientSubject(subjectId, depsFor(register));

  const edited = await saveCompanyProfileForUser(
    1,
    { ...BASE, legalName: "Alfa Holding s.r.o.", typedFields: ["legalName"] },
    START,
  );
  assert.equal(edited.ok, true);
  await verifyClientSubject(subjectId, depsFor(register));

  const row = await stateOf("legalName");
  assert.equal(row.state, "upravene-rucne");
  assert.equal(row.value, "Alfa Holding s.r.o.", "her value is kept");
  assert.equal(row.registerValue, "Alfa s.r.o.", "the register's value is shown beside it");
  assert.equal(row.restorable, true);

  const detail = await loadSubjectDetail(subjectId);
  const field = detail!.fields.find((item) => item.field === "legalName");
  assert.equal(field?.identity?.state, "upravene-rucne");
  assert.equal(field?.identity?.registerValue, "Alfa s.r.o.");
});

test("return to the register's value: the field is overené again, and it is no longer hers", async () => {
  const subjectId = await seedClient();
  const register = new FakeCompanyRegister({ lookups: [REGISTERED] });
  await saveCompanyProfileForUser(1, { ...BASE, legalName: "Alfa Holding s.r.o.", typedFields: ["legalName"] }, START);
  await verifyClientSubject(subjectId, depsFor(register));
  assert.equal((await stateOf("legalName")).state, "upravene-rucne");

  const restored = await restoreRegisterValueByHand({ subjectId, field: "legalName", now: START });
  assert.equal(restored.ok, true);

  const row = await stateOf("legalName");
  assert.equal(row.state, "overene");
  assert.equal(row.value, "Alfa s.r.o.");
  assert.equal(row.registerValue, "Alfa s.r.o.");
  const subject = await getSubject(subjectId);
  assert.deepEqual(subject!.manualFields, []);
  assert.deepEqual(subject!.findings, []);
});

test("a sheet value is overené when the register confirms it, and neoverené with the register's value when it does not", async () => {
  const subjectId = await seedClient();
  // What a client sheet import leaves: values from the sheet, not yet confirmed.
  const sheet: SubjectSource = "sheet";
  await updateSubject(subjectId, {
    legalName: "Alfa s.r.o.",
    address: "Bratislava",
    sources: { legalName: sheet, address: sheet, dic: "register" },
    manualFields: [],
  });
  const register = new FakeCompanyRegister({ lookups: [REGISTERED] });
  await verifyClientSubject(subjectId, depsFor(register));

  assert.equal((await stateOf("legalName")).state, "overene", "the sheet's name is the register's");
  const address = await stateOf("address");
  assert.equal(address.state, "neoverene", "the sheet's address is not the register's");
  assert.equal(address.value, "Bratislava");
  assert.equal(address.restorable, false, "a sheet value is not a hand edit to return from");
  assert.equal((await getSubject(subjectId))!.sources.address, "sheet", "the sheet value is kept, not overwritten");
});

test("a register outage changes nothing, and asks to be tried again", async () => {
  const subjectId = await seedClient();
  const register = new FakeCompanyRegister({ lookups: [REGISTERED] });
  register.failure = new Error("RPO nedostupné");

  await assert.rejects(verifyClientSubject(subjectId, depsFor(register)), ClientRegisterUnavailable);
  assert.equal((await stateOf("legalName")).state, "neoverene");
  assert.equal((await stateOf("ico")).state, "neoverene");
  assert.equal((await getSubject(subjectId))!.verifiedAt, null);
});

test("a subject the register does not hold is checked, and its fields stay neoverené", async () => {
  const subjectId = await seedClient();
  const register = new FakeCompanyRegister({ lookups: [] });

  await verifyClientSubject(subjectId, depsFor(register));

  assert.equal((await getSubject(subjectId))!.verifiedAt, START);
  assert.equal((await stateOf("ico")).state, "neoverene");
  assert.equal((await stateOf("legalName")).state, "neoverene");
});

test("an IČ DPH VIES confirms under the subject's own name is overené", async () => {
  const subjectId = await seedClient();
  await updateSubject(subjectId, { icDph: "SK2020311337", sources: { icDph: "manual" }, manualFields: ["icDph"] });
  const register = new FakeCompanyRegister({ lookups: [REGISTERED] });
  const vat = new FakeVatRegister({ SK2020311337: "Alfa s.r.o." });
  await verifyClientSubject(subjectId, { ...depsFor(register), vat });

  assert.deepEqual(vat.checks, ["SK2020311337"]);
  const subject = await getSubject(subjectId);
  assert.equal(subject!.sources.icDph, "vies");
  assert.deepEqual(subject!.manualFields, []);
  assert.equal((await stateOf("icDph")).state, "overene");
});

test("a correction on the Adresár queues the client's check, which gives the register's value back beside her edit", async () => {
  const subjectId = await seedClient();
  const register = new FakeCompanyRegister({ lookups: [REGISTERED] });
  await verifyClientSubject(subjectId, depsFor(register));

  queue.clientJobs.clear();
  const outcome = await correctSubjectByHand({ subjectId, field: "address", value: "Košice, Hlavná 1", now: START });
  assert.equal(outcome.ok, true);
  assert.deepEqual([...queue.clientJobs.keys()], [subjectId]);

  await verifyClientSubject(subjectId, depsFor(register));
  const row = await stateOf("address");
  assert.equal(row.state, "upravene-rucne");
  assert.equal(row.registerValue, "Bratislava, Pribinova 25");
  assert.equal(row.restorable, true);
});

test("the company's check is queued after a save, and a company with no subject queues nothing", async () => {
  await seedClient();
  queue.clientJobs.clear();
  await scheduleClientSubjectCheck(1);
  assert.equal(queue.clientJobs.size, 1);

  queue.clientJobs.clear();
  await scheduleClientSubjectCheck(999);
  assert.equal(queue.clientJobs.size, 0);
});

test("a client's page queues its check only when the register answer is as old as the refresh age, or never came", async () => {
  const subjectId = await seedClient();
  queue.clientJobs.clear();

  await scheduleStaleClientSubjectCheck(1);
  assert.deepEqual([...queue.clientJobs.keys()], [subjectId], "never checked: stale");

  queue.clientJobs.clear();
  await updateSubject(subjectId, { verifiedAt: new Date().toISOString() });
  await scheduleStaleClientSubjectCheck(1);
  assert.equal(queue.clientJobs.size, 0, "checked just now: fresh");

  await updateSubject(subjectId, { verifiedAt: "2020-01-01T00:00:00.000Z" });
  await scheduleStaleClientSubjectCheck(1);
  assert.equal(queue.clientJobs.size, 1, "years old: stale");
});

test("a client's subject queued twice is one job while it waits", async () => {
  const subjectId = await seedClient();
  // The save queued it and it still waits: a second queueing, from another replica, is refused.
  assert.equal(await queueClientSubjectCheck(subjectId, queue, START), false);
});
