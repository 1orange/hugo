import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { listSubjectAliases } from "../../../src/adapters/store/subjects.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { aliasKeyOf } from "../../../src/modules/subject-directory.ts";
import { companies, subjectAliases, subjects } from "../../../src/lib/db/schema.ts";
import type { RegisterLookup } from "../../../src/modules/company-profile.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import {
  SubjectLookupDeferred,
  correctSubjectField,
  linkClientCompany,
  resolveSubject,
  verifyCounterparty,
  type DirectoryDeps,
} from "../../../src/lib/subject-directory/service.ts";
import { freshTestDb } from "../support/test-db.ts";

const DAY = 24 * 60 * 60 * 1000;
/** A sighting from one document; tests that want two documents pass two ids. */
const doc = (documentId = "document-1") => ({ documentId });
const START = "2026-03-01T00:00:00.000Z";
// The clock the directory reads; a test moves it to make data stale.
let now = START;

function later(days: number): string {
  return new Date(Date.parse(START) + days * DAY).toISOString();
}

const ALFA: RegisterLookup = {
  country: "SK",
  ico: "31333532",
  legalName: "Alfa s.r.o.",
  address: "Bratislava, Pribinova 25",
  dic: "2020311335",
  formerNames: ["Alfa Trade, s.r.o."],
  status: "active",
};
const GAMMA_CZ: RegisterLookup = {
  country: "CZ",
  ico: "31333532",
  legalName: "Gamma s.r.o.",
  address: "Praha 1",
  dic: "CZ31333532",
  status: "active",
};

const ALFA_PARTY = { name: "Alfa s.r.o.", ico: "31333532", dic: "2020311335", icDph: "" };

function deps(register: FakeCompanyRegister, options: { perMinute?: number } = {}): DirectoryDeps {
  return {
    register,
    vat: new FakeVatRegister(),
    lock: new InProcessLookupLock(),
    limiter: createLookupRateLimiter({ perMinute: options.perMinute ?? 1000 }),
    refreshDays: 30,
    now: () => now,
    waitMs: 5000,
  };
}

async function allSubjects() {
  return getDb().select().from(subjects);
}

async function allAliases() {
  return getDb().select().from(subjectAliases);
}

test("the first resolution fetches the subject and stores it; later resolutions make no call", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA] });

  const first = await verifyCounterparty(ALFA_PARTY, deps(register), doc());

  assert.deepEqual(first.register, {
    legalName: "Alfa s.r.o.",
    formerNames: ["Alfa Trade, s.r.o."],
    dic: "2020311335",
    status: "active",
  });
  assert.deepEqual(register.lookupCalls, [{ ico: "31333532", country: "SK" }]);
  const [row] = await allSubjects();
  assert.equal(row!.country, "SK");
  assert.equal(row!.ico, "31333532");
  assert.equal(row!.legalName, "Alfa s.r.o.");
  assert.equal(row!.verifiedAt, START);

  await verifyCounterparty(ALFA_PARTY, deps(register), doc());
  await verifyCounterparty({ ...ALFA_PARTY, name: "ALFA s.r.o." }, deps(register), doc());
  assert.equal(register.lookupCalls.length, 1, "a fresh subject is not asked again");
  assert.equal((await allSubjects()).length, 1);
});

test("data older than the refresh age is refreshed on the next sighting", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA] });
  await verifyCounterparty(ALFA_PARTY, deps(register), doc());

  now = later(29);
  await verifyCounterparty(ALFA_PARTY, deps(register), doc());
  assert.equal(register.lookupCalls.length, 1, "29 days is still fresh");

  now = later(31);
  await verifyCounterparty(ALFA_PARTY, deps(register), doc());
  assert.equal(register.lookupCalls.length, 2);
  assert.equal((await allSubjects())[0]!.verifiedAt, later(31));
});

test("a Slovak and a Czech subject with the same IČO stay two subjects", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA, GAMMA_CZ] });

  const sk = await verifyCounterparty(ALFA_PARTY, deps(register), doc());
  const cz = await verifyCounterparty(
    { name: "Gamma s.r.o.", ico: "31333532", dic: "CZ31333532", icDph: "" },
    deps(register), doc()
  );

  assert.deepEqual(
    register.lookupCalls.map((call) => call.country),
    ["SK", "CZ"],
  );
  assert.notEqual(sk.subjectId, cz.subjectId);
  const rows = (await allSubjects()).filter((row) => row.ico === "31333532");
  assert.deepEqual(rows.map((row) => row.country).sort(), ["CZ", "SK"]);
  assert.equal(cz.register && "legalName" in cz.register ? cz.register.legalName : null, "Gamma s.r.o.");
});

test("a name a subject was printed under is recorded and resolves a later party without an IČO", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA] });

  const printed = await verifyCounterparty(
    { name: "Alfa Trade, s.r.o.", ico: "31333532", dic: "2020311335", icDph: "" },
    deps(register), doc()
  );
  const aliases = await listSubjectAliases(printed.subjectId!);
  assert.deepEqual(
    aliases.map((alias) => [alias.normalizedName, alias.count]),
    [[aliasKeyOf("Alfa Trade, s.r.o."), 1]],
  );

  const resolved = await resolveSubject({ name: "ALFA TRADE s.r.o.", ico: "", dic: "", icDph: "" });
  assert.equal(resolved?.id, printed.subjectId);

  const later = await verifyCounterparty({ name: "ALFA TRADE s.r.o.", ico: "", dic: "", icDph: "" }, deps(register), doc("document-2"));
  assert.equal(later.subjectId, printed.subjectId);
  assert.equal(register.lookupCalls.length, 1, "the alias needed no register");
  assert.equal((await listSubjectAliases(printed.subjectId!))[0]!.count, 2, "a second document counts");

  // Checking the same document again is not a second sighting.
  await verifyCounterparty({ name: "ALFA TRADE s.r.o.", ico: "", dic: "", icDph: "" }, deps(register), doc("document-2"));
  assert.equal((await listSubjectAliases(printed.subjectId!))[0]!.count, 2, "one document, one count");
});

test("a party with an IČO is never resolved by an alias: an unknown IČO is not another company's", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA] });
  await verifyCounterparty(ALFA_PARTY, deps(register), doc());

  const resolved = await resolveSubject({ name: "Alfa s.r.o.", ico: "35757442", dic: "2020357574", icDph: "" });
  assert.equal(resolved, null);
});

test("a register outage gives unavailable and leaves the directory as it was", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA] });
  register.failure = new Error("RÚZ lookup failed: HTTP 503");

  const check = await verifyCounterparty(ALFA_PARTY, deps(register), doc());

  assert.deepEqual(check.register, { unavailable: true });
  assert.equal(check.subjectId, null);
  assert.equal((await allSubjects()).length, 0, "no subject was written");
  assert.equal((await allAliases()).length, 0, "no sighting was recorded");

  register.failure = null;
  const recovered = await verifyCounterparty(ALFA_PARTY, deps(register), doc());
  assert.equal(recovered.register && "legalName" in recovered.register ? recovered.register.legalName : null, "Alfa s.r.o.");
});

test("a known subject judged on its stored data survives a stale refresh that fails", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA] });
  await verifyCounterparty(ALFA_PARTY, deps(register), doc());

  now = later(31);
  register.failure = new Error("ARES lookup failed: HTTP 500");
  const check = await verifyCounterparty(ALFA_PARTY, deps(register), doc());

  assert.equal(register.lookupCalls.length, 2, "the refresh was tried");
  assert.equal(check.register && "legalName" in check.register ? check.register.legalName : null, "Alfa s.r.o.");
  assert.equal((await allSubjects())[0]!.verifiedAt, START, "the failed refresh changed nothing");
});

test("a manual correction survives a refresh, and a disagreeing register answer becomes a finding", async () => {
  await freshTestDb();
  now = START;
  const first = await verifyCounterparty(ALFA_PARTY, deps(new FakeCompanyRegister({ lookups: [ALFA] })), doc());
  await correctSubjectField(first.subjectId!, "legalName", "Alfa Holding s.r.o.", START);

  now = later(31);
  await verifyCounterparty(ALFA_PARTY, deps(new FakeCompanyRegister({ lookups: [ALFA] })), doc());

  const [row] = await allSubjects();
  assert.equal(row!.legalName, "Alfa Holding s.r.o.", "her value is kept");
  assert.equal(row!.manualFieldsJson, JSON.stringify(["legalName"]));
  assert.deepEqual(JSON.parse(row!.findingsJson), [
    { field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: later(31) },
  ]);
  assert.equal(JSON.parse(row!.sourcesJson).legalName, "manual");
});

test("her company's IČO links its subject to the company; the profile wins where the directory differs", async () => {
  await freshTestDb();
  now = START;
  await getDb().insert(companies).values({ id: 1, driveFolderId: "delta-folder", name: "Delta s.r.o.", active: true });
  const DELTA = { ...ALFA, ico: "35757442", legalName: "Delta Holding s.r.o.", dic: "2020357574" };
  const register = new FakeCompanyRegister({ lookups: [DELTA] });
  // Delta appears as a counterparty of another client before her profile is set up.
  await verifyCounterparty(
    { name: "Delta Holding s.r.o.", ico: "35757442", dic: "2020357574", icDph: "" },
    deps(register), doc()
  );
  await saveCompanyProfile(1, {
    country: "SK",
    legalName: "Delta s.r.o.",
    address: "Košice",
    ico: "35757442",
    dic: "2020357574",
    icDph: "SK2020357574",
    registerSource: "fake",
    savedAt: START,
  });
  await linkClientCompany({
    companyId: 1,
    country: "SK",
    ico: "35757442",
    legalName: "Delta s.r.o.",
    address: "Košice",
    dic: "2020357574",
    icDph: "SK2020357574",
    now: START,
  });

  const resolved = await resolveSubject({ name: "Delta s.r.o.", ico: "35757442", dic: "2020357574", icDph: "" });
  assert.equal(resolved?.linkedCompanyId, 1);
  assert.deepEqual(resolved!.findings, [
    { field: "legalName", kind: "profile-disagrees", value: "Delta Holding s.r.o.", at: START },
  ]);

  const check = await verifyCounterparty(
    { name: "Delta s.r.o.", ico: "35757442", dic: "2020357574", icDph: "" },
    deps(register), doc()
  );
  assert.equal(check.subjectId, resolved?.id);
  assert.equal(register.lookupCalls.length, 1, "the client's own subject is fresh: no call");
});

test("a company whose profile changes its IČO is unlinked from the old one", async () => {
  await freshTestDb();
  now = START;
  await getDb().insert(companies).values({ id: 1, driveFolderId: "delta-folder", name: "Delta s.r.o.", active: true });
  const base = { companyId: 1, country: "SK" as const, legalName: "Delta s.r.o.", address: "", dic: "2020357574", icDph: "", now: START };
  await linkClientCompany({ ...base, ico: "35757442" });
  await linkClientCompany({ ...base, ico: "31333532" });

  const linked = (await allSubjects()).filter((row) => row.linkedCompanyId === 1);
  assert.deepEqual(linked.map((row) => row.ico), ["31333532"]);
});

test("concurrent resolutions of one subject make one register call", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA], delayMs: 30 });
  const shared = deps(register);

  const answers = await Promise.all([
    verifyCounterparty(ALFA_PARTY, shared, doc()),
    verifyCounterparty(ALFA_PARTY, shared, doc()),
    verifyCounterparty({ ...ALFA_PARTY, name: "Alfa Trade, s.r.o." }, shared, doc()),
  ]);

  assert.equal(register.lookupCalls.length, 1);
  for (const answer of answers) {
    assert.equal(answer.register && "legalName" in answer.register ? answer.register.legalName : null, "Alfa s.r.o.");
  }
  assert.equal((await allSubjects()).length, 1);
});

test("a lookup over the rate limit is refused for an unknown subject, and judged on data for a known one", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA, GAMMA_CZ] });
  const limited = deps(register, { perMinute: 1 });
  await verifyCounterparty(ALFA_PARTY, limited, doc());

  await assert.rejects(
    verifyCounterparty({ name: "Gamma s.r.o.", ico: "31333532", dic: "CZ31333532", icDph: "" }, limited, doc()),
    SubjectLookupDeferred,
  );
  assert.equal(register.lookupCalls.length, 1);
  assert.equal((await allSubjects()).length, 1, "the refused subject was not written");

  now = later(31);
  const stale = await verifyCounterparty(ALFA_PARTY, limited, doc());
  assert.equal(register.lookupCalls.length, 1, "the known stale subject was not looked up");
  assert.equal(stale.register && "legalName" in stale.register ? stale.register.legalName : null, "Alfa s.r.o.");
});

test("a foreign subject is kept by its VAT ID and never sent to a register", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA] });
  const acme = { name: "Acme GmbH", ico: "", dic: "", icDph: "DE123456789" };

  const first = await verifyCounterparty(acme, deps(register), doc());
  const second = await verifyCounterparty(acme, deps(register), doc());

  assert.equal(first.register, undefined);
  assert.equal(second.subjectId, first.subjectId);
  assert.equal(register.lookupCalls.length, 0);
  const [row] = await allSubjects();
  assert.equal(row!.country, "foreign");
  assert.equal(row!.vatId, "DE123456789");
});

test("an IČO the register does not hold is recorded as verified with no name", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [] });
  const party = { name: "Nobody s.r.o.", ico: "31333532", dic: "2020311335", icDph: "" };

  const first = await verifyCounterparty(party, deps(register), doc());
  const second = await verifyCounterparty(party, deps(register), doc());

  assert.deepEqual(first.register, { notFound: true });
  assert.deepEqual(second.register, { notFound: true });
  assert.equal(register.lookupCalls.length, 1);
  assert.equal((await allSubjects())[0]!.legalName, null);
});

const ICO_ONLY = (name: string) => ({ name, ico: "31333532", dic: "", icDph: "" });

test("a party with only an IČO is looked up in the Slovak register first", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA, GAMMA_CZ] });

  const check = await verifyCounterparty(ICO_ONLY("Alfa s.r.o."), deps(register), doc());

  assert.deepEqual(register.lookupCalls, [{ ico: "31333532", country: "SK" }]);
  assert.equal(check.register && "legalName" in check.register ? check.register.legalName : null, "Alfa s.r.o.");
  const rows = await allSubjects();
  assert.deepEqual(rows.map((row) => [row.country, row.id === check.subjectId]), [["SK", true]]);

  await verifyCounterparty(ICO_ONLY("Alfa s.r.o."), deps(register), doc("document-2"));
  assert.equal(register.lookupCalls.length, 1, "a fresh subject is not asked again");
});

test("a party with only an IČO the Slovak register does not hold is looked up in the Czech one", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [GAMMA_CZ] });

  const check = await verifyCounterparty(ICO_ONLY("Gamma s.r.o."), deps(register), doc());

  assert.deepEqual(
    register.lookupCalls.map((call) => call.country),
    ["SK", "CZ"],
  );
  assert.equal(check.register && "legalName" in check.register ? check.register.legalName : null, "Gamma s.r.o.");
  const rows = await allSubjects();
  assert.deepEqual(rows.map((row) => row.country), ["CZ"], "the Slovak absence creates no empty subject");

  // Known now: the Czech subject answers without asking the Slovak register again.
  await verifyCounterparty(ICO_ONLY("Gamma s.r.o."), deps(register), doc("document-2"));
  assert.equal(register.lookupCalls.length, 2);
});

test("a party with only an IČO neither register holds is not found, and one that could not be asked is unavailable", async () => {
  await freshTestDb();
  now = START;
  const nowhere = await verifyCounterparty(ICO_ONLY("Nobody s.r.o."), deps(new FakeCompanyRegister({ lookups: [] })), doc());
  assert.deepEqual(nowhere, { subjectId: null, register: { notFound: true } });
  assert.equal((await allSubjects()).length, 0);

  const down = new FakeCompanyRegister({ lookups: [] });
  down.failure = new Error("RPO is down");
  const outage = await verifyCounterparty(ICO_ONLY("Alfa s.r.o."), deps(down), doc());
  assert.deepEqual(outage, { subjectId: null, register: { unavailable: true } });
});

test("a party with only an IČO failing its checksum is not looked up", async () => {
  await freshTestDb();
  now = START;
  const register = new FakeCompanyRegister({ lookups: [ALFA] });

  const check = await verifyCounterparty({ name: "Alfa s.r.o.", ico: "31333533", dic: "", icDph: "" }, deps(register), doc());

  assert.equal(check.subjectId, null);
  assert.equal(check.register, undefined);
  assert.equal(register.lookupCalls.length, 0);
});
