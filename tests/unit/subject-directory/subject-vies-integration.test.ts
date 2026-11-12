import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { MemorySubjectVerificationQueue } from "../../../src/adapters/job-queue/memory-subject-verification-queue.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { ensureDocumentsForMonth, getDocument, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { findSubjectByIco, getSubject } from "../../../src/adapters/store/subjects.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, files, months } from "../../../src/lib/db/schema.ts";
import { confirmDocument } from "../../../src/lib/documents/service.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import { useSubjectVerificationQueue } from "../../../src/lib/subject-directory/queue.ts";
import { queueSubjectChecksForMonth } from "../../../src/lib/subject-directory/schedule.ts";
import {
  resolveSubject,
  setSubjectVatGroup,
  verifyCounterparty,
  correctSubjectField,
  type DirectoryDeps,
} from "../../../src/lib/subject-directory/service.ts";
import { verifyDocumentParties } from "../../../src/lib/subject-directory/verify-document.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import {
  parsePartyIntegrityRecord,
  subjectFindingMessage,
  type SubjectCheck,
} from "../../../src/modules/subject-integrity.ts";
import { freshTestDb } from "../support/test-db.ts";

const DAY = 24 * 60 * 60 * 1000;
/** A sighting from one document, for the directory calls below. */
const doc = (documentId = "vies-document") => ({ documentId });
const MINUTE = 60_000;
const START = "2026-02-01T00:00:00.000Z";
const MONTH = "2026_02";
const SLOT_02 = "vies-slot-02";
const MONTH_FOLDER = "vies-month";
const GROUP = "SK7120001713";
// A synthetic-free public example of a plain (not group) registration, as VIES measured it (ADR 0018).
const SPRING_NAME = "SPRING.etc., spol. s r. o.";
const GROUP_HOLDER = "Group registration - This VAT ID corresponds to a Group of Taxpayers";

let now = START;

function later(days: number): string {
  return new Date(Date.parse(START) + days * DAY).toISOString();
}

// Her company, the customer of every invoice here: checked against her profile, never VIES.
const CLIENT = { name: "Delta s.r.o.", ico: "31333532", dic: "2020311337", icDph: "SK2020311337" };
// Slovnaft (public, cited in ADR 0018): a VAT group member. Its receipts print the group's number.
const SLOVNAFT = { name: "Slovnaft, a. s.", ico: "31322832", dic: "2020372640" };
const SLOVNAFT_REGISTER = {
  country: "SK" as const,
  ico: "31322832",
  legalName: "Slovnaft, a. s.",
  address: "Bratislava",
  dic: "2020372640",
  status: "active" as const,
};
// A synthetic member of the same group: the group number must not resolve it to Slovnaft.
const MEMBER_B = { name: "Beta Group, s. r. o.", ico: "35757442", dic: "2020357574" };
const MEMBER_B_REGISTER = {
  country: "SK" as const,
  ico: "35757442",
  legalName: "Beta Group, s. r. o.",
  address: "Košice",
  dic: "2020357574",
  status: "active" as const,
};

function deps(register: FakeCompanyRegister, vat: FakeVatRegister): DirectoryDeps {
  return {
    register,
    vat,
    lock: new InProcessLookupLock(),
    limiter: createLookupRateLimiter({ perMinute: 1000 }),
    refreshDays: 30,
    now: () => now,
    waitMs: 5000,
  };
}

async function seedMonth(): Promise<void> {
  await freshTestDb();
  now = START;
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: "vies-company", name: "Delta s.r.o.", active: true });
  await db.insert(months).values({ id: 1, companyId: 1, monthKey: MONTH, driveFolderId: MONTH_FOLDER, closedAt: null, openedAt: START });
  await saveCompanyProfile(1, {
    country: "SK",
    legalName: CLIENT.name,
    address: "Bratislava",
    ico: CLIENT.ico,
    dic: CLIENT.dic,
    icDph: CLIENT.icDph,
    registerSource: "fake",
    savedAt: START,
  });
}

function invoice(id: string, supplier: ModelExtractedPayload["parties"][number]): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [supplier, CLIENT],
    documentNumber: `FA-${id}`,
    variableSymbol: id,
    issueDate: "2026-02-03",
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 12000,
    amountLiteral: "120.00",
    vatRecap: [],
    docTypeHint: "invoice",
  };
}

/** A received invoice of her company, read and waiting for its party check. */
async function addInvoice(id: string, supplier: ModelExtractedPayload["parties"][number]): Promise<void> {
  await getDb().insert(files).values({
    driveFileId: id,
    companyId: 1,
    monthKey: MONTH,
    folderSlot: "02 Prijaté faktúry",
    parentId: SLOT_02,
    name: `${id}.pdf`,
    mimeType: "application/pdf",
    driveCreatedTime: START,
    firstSeenAt: START,
    lastSeenAt: START,
    deleted: false,
  });
  await ensureDocumentsForMonth(1, MONTH, START);
  await writeExtractedPayload(id, invoice(id, supplier), "complete", null);
}

async function checkOf(id: string, side: "supplier" | "customer"): Promise<SubjectCheck> {
  const record = parsePartyIntegrityRecord((await getDocument(id))!.partyIntegrityJson);
  assert.ok(record, `${id} has a stored verdict`);
  return record[side];
}

function codesOf(check: SubjectCheck): string[] {
  return check.findings.map((item) => item.code);
}

async function subjectOf(ico: string) {
  return findSubjectByIco("SK", ico);
}

// --- The directory: VIES asked once per subject and VAT ID ------------------------

test("VIES is asked once per subject and VAT ID per refresh period", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister({ [GROUP]: GROUP_HOLDER });
  const party = { ...SLOVNAFT, icDph: GROUP };

  const first = await verifyCounterparty(party, deps(register, vat), doc());
  assert.deepEqual(first.vies, { valid: true, holderName: GROUP_HOLDER });
  assert.equal(first.vatGroupId, null);

  now = later(29);
  await verifyCounterparty(party, deps(register, vat), doc());
  assert.deepEqual(vat.checks, [GROUP], "29 days is still fresh");

  now = later(31);
  await verifyCounterparty(party, deps(register, vat), doc());
  assert.deepEqual(vat.checks, [GROUP, GROUP], "after the refresh period VIES is asked again");
});

test("VIES is asked once across concurrent checks of one subject", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister({ [GROUP]: GROUP_HOLDER });
  vat.delayMs = 30;
  const shared = deps(register, vat);
  const party = { ...SLOVNAFT, icDph: GROUP };

  const answers = await Promise.all([
    verifyCounterparty(party, shared, doc()),
    verifyCounterparty(party, shared, doc()),
    verifyCounterparty({ ...party, name: "Slovnaft a.s." }, shared, doc()),
  ]);

  assert.deepEqual(vat.checks, [GROUP], "one VIES call for the three checks");
  for (const answer of answers) {
    assert.deepEqual(answer.vies, { valid: true, holderName: GROUP_HOLDER });
  }
});

test("a VIES outage leaves the stored answer in force, and a first outage is unavailable for that check only", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister({ SK2020372640: "Slovnaft, a. s." });
  const party = { ...SLOVNAFT, icDph: "SK2020372640" };

  const first = await verifyCounterparty(party, deps(register, vat), doc());
  assert.deepEqual(first.vies, { valid: true, holderName: "Slovnaft, a. s." });

  now = later(31);
  vat.failure = new Error("VIES: MS_UNAVAILABLE");
  const stale = await verifyCounterparty(party, deps(register, vat), doc());
  assert.deepEqual(stale.vies, { valid: true, holderName: "Slovnaft, a. s." }, "judged on the stored answer");
  assert.deepEqual(stale.register && "legalName" in stale.register ? stale.register.legalName : null, "Slovnaft, a. s.");

  const other = await verifyCounterparty({ name: SPRING_NAME, ico: "", dic: "", icDph: "SK2023141351" }, deps(register, vat), doc());
  assert.deepEqual(other.vies, { unavailable: true }, "no stored answer: unavailable, and nothing else is changed");
});

test("a number VIES confirmed and then stops knowing is lapsed from that refresh on", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [] });
  const party = { name: SPRING_NAME, ico: "", dic: "", icDph: "SK2023141351" };
  const vat = new FakeVatRegister({ SK2023141351: SPRING_NAME });

  assert.deepEqual((await verifyCounterparty(party, deps(register, vat), doc())).vies, { valid: true, holderName: SPRING_NAME });

  now = later(31);
  const gone = new FakeVatRegister({});
  const lapsed = await verifyCounterparty(party, deps(register, gone), doc());
  assert.deepEqual(lapsed.vies, { valid: false, holderName: null, lapsed: true });

  const subject = await resolveSubject(party);
  assert.ok(subject);
  assert.equal(subject.viesStatus["SK2023141351"]?.lapsedAt, later(31));
});

// --- The group number belongs to every member: it resolves no one -------------------

test("a VAT group number does not resolve a different member's subject", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER, MEMBER_B_REGISTER] });
  const vat = new FakeVatRegister({ [GROUP]: GROUP_HOLDER });
  await verifyCounterparty({ ...SLOVNAFT, icDph: GROUP }, deps(register, vat), doc());

  const resolved = await resolveSubject({ ...MEMBER_B, icDph: GROUP });
  assert.equal(resolved, null, "Beta Group is not Slovnaft, though both print the group number");
});

// --- Group membership: recorded by her, or by a confirmed document ------------------

test("the membership recorded by her verifies the group's IČ DPH: a notice before, verified after", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister({ [GROUP]: GROUP_HOLDER });
  await addInvoice("vies-receipt-1", { ...SLOVNAFT, icDph: GROUP });

  await verifyDocumentParties("vies-receipt-1", deps(register, vat));
  const before = await checkOf("vies-receipt-1", "supplier");
  assert.equal(before.verdict, "notice");
  assert.deepEqual(codesOf(before), ["vat-group-unconfirmed"]);

  const subject = await subjectOf("31322832");
  assert.ok(subject);
  await setSubjectVatGroup(subject.id, GROUP);
  assert.equal((await getSubject(subject.id))?.vatGroupId, GROUP);

  await verifyDocumentParties("vies-receipt-1", deps(register, vat));
  const after = await checkOf("vies-receipt-1", "supplier");
  assert.equal(after.verdict, "verified");
  assert.deepEqual(after.findings, []);
  assert.deepEqual(vat.checks, [GROUP], "the group's VIES answer was asked once");
});

test("a correction of the VAT group through the field rule is the same record", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister({ [GROUP]: GROUP_HOLDER });
  await addInvoice("vies-receipt-2", { ...SLOVNAFT, icDph: GROUP });
  await verifyDocumentParties("vies-receipt-2", deps(register, vat));
  const subject = await subjectOf("31322832");
  assert.ok(subject);

  const updated = await correctSubjectField(subject.id, "vatGroupId", `sk ${GROUP.slice(2)}`, now);
  assert.equal(updated?.vatGroupId, GROUP);
  assert.equal(updated?.sources.vatGroupId, "manual");
  assert.deepEqual(updated?.manualFields, ["vatGroupId"]);
});

test("a confirmed document that shows the group IČ DPH records her subject as a member; an unconfirmed one does not", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER, MEMBER_B_REGISTER] });
  const vat = new FakeVatRegister({ [GROUP]: GROUP_HOLDER });
  const queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);
  try {
    await addInvoice("vies-receipt-3", { ...SLOVNAFT, icDph: GROUP });
    await addInvoice("vies-receipt-4", { ...MEMBER_B, icDph: GROUP });

    // Unconfirmed: nothing is recorded, however often it is checked.
    await verifyDocumentParties("vies-receipt-3", deps(register, vat));
    assert.equal((await subjectOf("31322832"))?.vatGroupId, null);

    // Confirmed by her: the confirmation queues the check, and the check records the membership.
    assert.equal(
      (await confirmDocument({ companyId: 1, monthKey: MONTH, documentId: "vies-receipt-3", confirmed: true, now: START })).ok,
      true,
    );
    assert.deepEqual([...queue.jobs.keys()], ["vies-receipt-3"]);
    await verifyDocumentParties("vies-receipt-3", deps(register, vat));

    const slovnaft = await subjectOf("31322832");
    assert.equal(slovnaft?.vatGroupId, GROUP);
    assert.equal(slovnaft?.sources.vatGroupId, "vies");
    assert.deepEqual(slovnaft?.manualFields, [], "evidence, not her correction");
    assert.equal((await checkOf("vies-receipt-3", "supplier")).verdict, "verified");

    // Another member of the group, not confirmed: still a notice, and VIES is asked for its own subject.
    await verifyDocumentParties("vies-receipt-4", deps(register, vat));
    assert.equal((await checkOf("vies-receipt-4", "supplier")).verdict, "notice");
    assert.equal((await subjectOf("35757442"))?.vatGroupId, null);
  } finally {
    useSubjectVerificationQueue(null);
  }
});

test("a notice waiting for a membership is checked again after ten minutes, and a current verdict is not", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister({ [GROUP]: GROUP_HOLDER });
  await addInvoice("vies-receipt-5", { ...SLOVNAFT, icDph: GROUP });
  await verifyDocumentParties("vies-receipt-5", deps(register, vat));

  const soon = new MemorySubjectVerificationQueue();
  assert.equal(await queueSubjectChecksForMonth(1, MONTH, soon, new Date(Date.parse(START) + 5 * MINUTE).toISOString()), 0);
  assert.equal(
    await queueSubjectChecksForMonth(1, MONTH, soon, new Date(Date.parse(START) + 11 * MINUTE).toISOString()),
    1,
  );

  const subject = await subjectOf("31322832");
  await setSubjectVatGroup(subject!.id, GROUP);
  await verifyDocumentParties("vies-receipt-5", deps(register, vat));
  const checked = new MemorySubjectVerificationQueue();
  assert.equal(await queueSubjectChecksForMonth(1, MONTH, checked, START), 0);
});

// --- Dissolved and deregistered subjects, on new documents -----------------------------

test("a subject the register now shows dissolved is flagged on documents verified from then on, not on earlier ones", async () => {
  await seedMonth();
  const party = { ...SLOVNAFT, icDph: "" };
  await addInvoice("vies-old", party);
  await verifyDocumentParties("vies-old", deps(new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] }), new FakeVatRegister()));
  assert.equal((await checkOf("vies-old", "supplier")).verdict, "verified");

  now = later(31);
  await addInvoice("vies-new", party);
  const dissolved = { ...SLOVNAFT_REGISTER, status: "dissolved" as const };
  await verifyDocumentParties("vies-new", deps(new FakeCompanyRegister({ lookups: [dissolved] }), new FakeVatRegister()));

  const flagged = await checkOf("vies-new", "supplier");
  assert.equal(flagged.verdict, "notice");
  assert.deepEqual(codesOf(flagged), ["register-dissolved"]);
  assert.equal(subjectFindingMessage(flagged.findings[0]!), "Subjekt je v registri vedený ako zaniknutý.");
  assert.equal((await checkOf("vies-old", "supplier")).verdict, "verified", "an earlier verdict is not changed by a later register answer");
});

test("an IČ DPH that VIES lapsed is flagged on documents verified after the lapse", async () => {
  await seedMonth();
  const party = { name: SPRING_NAME, ico: "", dic: "", icDph: "SK2023141351" };
  await addInvoice("vies-before", party);
  await verifyDocumentParties("vies-before", deps(new FakeCompanyRegister(), new FakeVatRegister({ SK2023141351: SPRING_NAME })));
  assert.equal((await checkOf("vies-before", "supplier")).verdict, "verified");

  now = later(31);
  await addInvoice("vies-after", party);
  await verifyDocumentParties("vies-after", deps(new FakeCompanyRegister(), new FakeVatRegister({})));

  const after = await checkOf("vies-after", "supplier");
  assert.equal(after.verdict, "mismatch");
  assert.deepEqual(codesOf(after), ["vies-lapsed"]);
  assert.equal((await checkOf("vies-before", "supplier")).verdict, "verified");
});

// --- Outages: the register checks stand, and the client is never sent to VIES ------------

test("a VIES outage on a document leaves its register checks in force and the client unchanged", async () => {
  await seedMonth();
  await addInvoice("vies-outage", { ...SLOVNAFT, icDph: "SK2020372640" });
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister();
  vat.failure = new Error("VIES: TIMEOUT");

  await verifyDocumentParties("vies-outage", deps(register, vat));

  const supplier = await checkOf("vies-outage", "supplier");
  assert.equal(supplier.verdict, "verified", "the register confirms the name and the DIČ");
  assert.deepEqual(codesOf(supplier), ["vies-unavailable"]);
  assert.equal((await checkOf("vies-outage", "customer")).verdict, "verified", "her own party is checked against her profile");
  assert.deepEqual(vat.checks, ["SK2020372640"], "only the counterparty's VAT ID was ever asked");
});

test("a VIES outage does not hide a register mismatch on the document", async () => {
  await seedMonth();
  await addInvoice("vies-mismatch", { name: "Alfa s.r.o.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" });
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister();
  vat.failure = new Error("VIES: MS_UNAVAILABLE");

  await verifyDocumentParties("vies-mismatch", deps(register, vat));

  assert.equal((await checkOf("vies-mismatch", "supplier")).verdict, "mismatch");
});

test("an IČ DPH VIES does not know is a mismatch on the document, and the client's VAT ID is never asked", async () => {
  await seedMonth();
  await addInvoice("vies-invalid", { ...SLOVNAFT, icDph: "SK2020372640" });
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister();

  await verifyDocumentParties("vies-invalid", deps(register, vat));

  const supplier = await checkOf("vies-invalid", "supplier");
  assert.equal(supplier.verdict, "mismatch");
  assert.deepEqual(codesOf(supplier), ["vies-invalid"]);
  assert.deepEqual(vat.checks, ["SK2020372640"]);
  assert.equal((await subjectOf("31322832"))?.viesStatus["SK2020372640"]?.valid, false);
});

test("the subject of a group member is kept with its own VIES answer", async () => {
  await seedMonth();
  const register = new FakeCompanyRegister({ lookups: [SLOVNAFT_REGISTER] });
  const vat = new FakeVatRegister({ [GROUP]: GROUP_HOLDER });
  const check = await verifyCounterparty({ ...SLOVNAFT, icDph: GROUP }, deps(register, vat), doc());
  const subject = await getSubject(check.subjectId!);
  assert.deepEqual(Object.keys(subject!.viesStatus), [GROUP]);
});
