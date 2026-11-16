import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { ensureDocumentsForMonth, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, events, files, months, subjects } from "../../../src/lib/db/schema.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
import { buildMonthDocumentView, type DocumentListItem } from "../../../src/lib/documents/view.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import { correctSubjectByHand } from "../../../src/lib/subject-directory/correction.ts";
import { loadSubjectDetail, listSubjectDirectory } from "../../../src/lib/subject-directory/screen.ts";
import { verifyCounterparty, type DirectoryDeps } from "../../../src/lib/subject-directory/service.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * The *Adresár* screen's behaviour (PRD 0004 stories 48–51): search over the
 * directory, the detail with its references, and a correction that is kept over
 * a refresh, recorded in the event log, and seen through the directory by the
 * documents that reference the subject.
 */

const MONTH = "2026_04";
const START = "2026-04-06T08:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const FOLDER = "02 Prijaté faktúry";
const CLIENT = { name: "Delta s.r.o.", ico: "31333532", dic: "2020311337", icDph: "SK2020311337" };
const ALFA_PARTY = { name: "Alfa s.r.o.", ico: "31322832", dic: "2020322832", icDph: "SK2020322832" };
const ALFA_REGISTER = {
  country: "SK" as const,
  ico: "31322832",
  legalName: "Alfa s.r.o.",
  address: "Bratislava, Pribinova 25",
  dic: "2020322832",
  formerNames: ["Alfa Trade, s.r.o."],
  status: "active" as const,
};
const CENTRAL_REGISTER = {
  country: "SK" as const,
  ico: "35757442",
  legalName: "Central, a. s.",
  address: "Bratislava",
  dic: "2020357574",
  status: "active" as const,
};

let now = START;

function later(days: number): string {
  return new Date(Date.parse(START) + days * DAY).toISOString();
}

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

async function seedTwoClients(): Promise<void> {
  await freshTestDb();
  now = START;
  const db = getDb();
  await db.insert(companies).values([
    { id: 1, driveFolderId: "delta-company", name: "Delta s.r.o.", active: true },
    { id: 2, driveFolderId: "beta-company", name: "Beta s.r.o.", active: true },
  ]);
  for (const companyId of [1, 2]) {
    await db.insert(months).values({
      id: companyId,
      companyId,
      monthKey: MONTH,
      driveFolderId: `month-${companyId}`,
      closedAt: null,
      openedAt: "2026-04-01T00:00:00.000Z",
    });
  }
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

function invoice(supplier: ModelExtractedPayload["parties"][number], clientCompanyPartyName = CLIENT.name): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [supplier, { name: clientCompanyPartyName, ico: CLIENT.ico, dic: CLIENT.dic, icDph: CLIENT.icDph }],
    documentNumber: "FA-9",
    variableSymbol: "9",
    issueDate: "2026-04-05",
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 12000,
    amountLiteral: "120.00",
    vatRecap: [],
    docTypeHint: "invoice",
  };
}

/** A document of one client company, with the supplier printed as given. */
async function addInvoice(
  companyId: number,
  id: string,
  supplier: ModelExtractedPayload["parties"][number],
): Promise<void> {
  await getDb().insert(files).values({
    driveFileId: id,
    companyId,
    monthKey: MONTH,
    folderSlot: FOLDER,
    parentId: `slot-${companyId}`,
    name: `${id}.pdf`,
    mimeType: "application/pdf",
    driveCreatedTime: START,
    firstSeenAt: START,
    lastSeenAt: START,
    deleted: false,
  });
  await ensureDocumentsForMonth(companyId, MONTH, START);
  await writeExtractedPayload(id, invoice(supplier), "complete", null);
  // The extraction pipeline stamps the version it read with; enrichment applies to that contract.
  await getDb().update(documents).set({ extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION }).where(eq(documents.id, id));
}

async function itemOf(companyId: number, id: string): Promise<DocumentListItem> {
  const view = await buildMonthDocumentView(companyId, MONTH);
  const item = view!.documents.find((document) => document.id === id);
  assert.ok(item, `${id} is listed`);
  return item;
}

/** Teaches the directory Alfa: its register answer and VIES's answer for its IČ DPH. */
async function learnAlfa(): Promise<number> {
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  const vat = new FakeVatRegister({ SK2020322832: "Alfa s.r.o." });
  const check = await verifyCounterparty(ALFA_PARTY, deps(register, vat), { documentId: "learn-alfa" });
  assert.ok(check.subjectId !== null);
  return check.subjectId!;
}

async function subjectRow(id: number) {
  const [row] = await getDb().select().from(subjects).where(eq(subjects.id, id));
  assert.ok(row);
  return row;
}

test("the directory is found by name, alias, IČO, DIČ and IČ DPH, and the list says how many match", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();
  const central = await verifyCounterparty(
    { name: "CENTRAL Bratislava", ico: "35757442", dic: "2020357574", icDph: "" },
    deps(new FakeCompanyRegister({ lookups: [CENTRAL_REGISTER] }), new FakeVatRegister()),
    { documentId: "learn-central" },
  );

  const names = async (query: string) => (await listSubjectDirectory(query)).rows.map((row) => row.id);

  assert.deepEqual(await names("alfa"), [alfaId]);
  assert.deepEqual(await names("ALFA TRADE"), [alfaId], "a former name finds it");
  assert.deepEqual(await names("central bratislava"), [central.subjectId], "the alias finds the subject it was printed under");
  assert.deepEqual(await names("31 322 832"), [alfaId], "an IČO with spaces");
  assert.deepEqual(await names("2020 322 832"), [alfaId], "a DIČ with spaces");
  assert.deepEqual(await names("sk 2020322832"), [alfaId], "an IČ DPH with its prefix and spaces");
  assert.deepEqual(await names("nic-taketo"), []);

  // The client's own company is a subject too: its profile is its record in the Adresár (ADR 0022, amended).
  const all = await listSubjectDirectory("");
  assert.equal(all.total, 3);
  assert.equal(all.rows.length, 3);
});

test("the list caps its rows and still says how many subjects matched", async () => {
  await seedTwoClients();
  for (let index = 0; index < 3; index += 1) {
    await verifyCounterparty(
      { name: `Gamma ${index} s.r.o.`, ico: "", dic: "", icDph: `DE12345678${index}` },
      deps(new FakeCompanyRegister(), new FakeVatRegister()),
      { documentId: `gamma-${index}` },
    );
  }
  // Three gammas and the client's own company (Delta s.r.o.) match.
  const capped = await listSubjectDirectory("s.r.o.", 2);
  assert.equal(capped.total, 4);
  assert.equal(capped.rows.length, 2);
});

test("the detail lists the companies and documents that reference the subject, each linked to its document", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();
  await addInvoice(1, "delta-invoice-1", { name: "Alfa s.r.o.", ico: "31322832", dic: "", icDph: "" });
  await addInvoice(2, "beta-invoice-1", { name: "Alfa s.r.o.", ico: "31322832", dic: "", icDph: "" });
  await verifyCounterparty(ALFA_PARTY, deps(new FakeCompanyRegister(), new FakeVatRegister()), { documentId: "delta-invoice-1" });
  await verifyCounterparty(ALFA_PARTY, deps(new FakeCompanyRegister(), new FakeVatRegister()), { documentId: "beta-invoice-1" });

  const detail = await loadSubjectDetail(alfaId);
  assert.ok(detail);
  assert.equal(detail.legalName, "Alfa s.r.o.");
  assert.deepEqual(
    detail.references.documents.map((document) => [document.companyName, document.monthLabel, document.href]),
    [
      ["Beta s.r.o.", "apríl 2026", `/companies/2/${MONTH}?doc=beta-invoice-1`],
      ["Delta s.r.o.", "apríl 2026", `/companies/1/${MONTH}?doc=delta-invoice-1`],
    ],
  );
  assert.deepEqual(detail.references.companies.map((company) => company.name).sort(), ["Beta s.r.o.", "Delta s.r.o."]);
  assert.equal(await loadSubjectDetail(alfaId + 999), null);
});

test("the detail shows each value with its source, the register and VIES statuses, and the former names", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();
  const detail = await loadSubjectDetail(alfaId);
  assert.ok(detail);

  const byField = Object.fromEntries(detail.fields.map((field) => [field.field, field]));
  assert.equal(byField.legalName!.sourceLabel, "z registra");
  assert.equal(byField.dic!.sourceLabel, "z registra");
  assert.equal(byField.icDph!.sourceLabel, "z VIES");
  assert.equal(byField.legalName!.manual, false);
  assert.deepEqual(detail.formerNames, ["Alfa Trade, s.r.o."]);
  assert.equal(detail.registerStatusLabel, "aktívny");
  assert.deepEqual(detail.vies.map((vies) => [vies.vatId, vies.label]), [["SK2020322832", "platné"]]);
  assert.equal(detail.verdict, "verified");
  assert.match(detail.verifiedAtLabel, /06\.04\.2026/);
});

test("a manual correction persists, shows as manual, survives a refresh, and a disagreeing refresh becomes a finding", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();

  const outcome = await correctSubjectByHand({ subjectId: alfaId, field: "legalName", value: "  Alfa Holding s.r.o. ", now: START });
  assert.equal(outcome.ok, true);

  const row = await subjectRow(alfaId);
  assert.equal(row.legalName, "Alfa Holding s.r.o.");
  assert.equal(row.manualFieldsJson, JSON.stringify(["legalName"]));
  assert.equal(JSON.parse(row.sourcesJson).legalName, "manual");

  const events_ = await getDb().select().from(events).where(eq(events.type, "SubjectCorrected"));
  assert.equal(events_.length, 1);
  assert.equal(events_[0]!.companyId, null);
  assert.equal(events_[0]!.actor, "user");
  assert.deepEqual(JSON.parse(events_[0]!.payloadJson), {
    subjectId: alfaId,
    subjectName: "Alfa s.r.o.",
    field: "legalName",
    previous: "Alfa s.r.o.",
    next: "Alfa Holding s.r.o.",
  });

  // The register still says the old name, a month later: her value holds, and the disagreement is a finding.
  now = later(31);
  await verifyCounterparty(ALFA_PARTY, deps(new FakeCompanyRegister({ lookups: [ALFA_REGISTER] }), new FakeVatRegister({ SK2020322832: "Alfa s.r.o." })), {
    documentId: "refresh-alfa",
  });
  const refreshed = await subjectRow(alfaId);
  assert.equal(refreshed.legalName, "Alfa Holding s.r.o.", "a refresh does not overwrite the correction");
  assert.deepEqual(JSON.parse(refreshed.findingsJson), [
    { field: "legalName", kind: "register-disagrees", value: "Alfa s.r.o.", at: later(31) },
  ]);

  const detail = await loadSubjectDetail(alfaId);
  assert.ok(detail);
  assert.equal(detail.fields.find((field) => field.field === "legalName")!.sourceLabel, "ručne");
  assert.equal(detail.fields.find((field) => field.field === "legalName")!.manual, true);
  assert.deepEqual(detail.findings.map((finding) => finding.message), [
    "Názov: register dnes uvádza „Alfa s.r.o.“, ručná oprava sa líši.",
  ]);
  assert.equal(detail.verdict, "mismatch");

  // The register catches up with her value: the finding clears.
  now = later(62);
  await verifyCounterparty(
    ALFA_PARTY,
    deps(new FakeCompanyRegister({ lookups: [{ ...ALFA_REGISTER, legalName: "Alfa Holding s.r.o." }] }), new FakeVatRegister({ SK2020322832: "Alfa s.r.o." })),
    { documentId: "refresh-alfa-2" },
  );
  assert.deepEqual(JSON.parse((await subjectRow(alfaId)).findingsJson), []);
});

test("a corrected IČ DPH is kept, and a VIES answer that agrees with the old one does not replace it", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();
  const outcome = await correctSubjectByHand({ subjectId: alfaId, field: "icDph", value: "sk 7120001713", now: START });
  assert.equal(outcome.ok, true);

  now = later(31);
  await verifyCounterparty(ALFA_PARTY, deps(new FakeCompanyRegister({ lookups: [ALFA_REGISTER] }), new FakeVatRegister({ SK2020322832: "Alfa s.r.o." })), {
    documentId: "vies-alfa",
  });
  const row = await subjectRow(alfaId);
  assert.equal(row.icDph, "SK7120001713");
  assert.equal(JSON.parse(row.sourcesJson).icDph, "manual");
});

test("a correction is seen by the documents that reference the subject, on their next view, and they are queued for a check", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();
  // The counterparty prints its name and IČO only: the directory fills its DIČ.
  await addInvoice(1, "delta-missing-dic", { name: "Alfa s.r.o.", ico: "31322832", dic: "", icDph: "" });
  // Another prints a DIČ of its own: a printed value is never replaced.
  await addInvoice(2, "beta-printed-dic", { name: "Alfa s.r.o.", ico: "31322832", dic: "2020999999", icDph: "" });
  await verifyCounterparty(ALFA_PARTY, deps(new FakeCompanyRegister(), new FakeVatRegister()), { documentId: "delta-missing-dic" });
  await verifyCounterparty(ALFA_PARTY, deps(new FakeCompanyRegister(), new FakeVatRegister()), { documentId: "beta-printed-dic" });

  assert.equal((await itemOf(1, "delta-missing-dic")).fieldEditor.fields.dic, "2020322832");

  const queued: string[][] = [];
  const outcome = await correctSubjectByHand({
    subjectId: alfaId,
    field: "dic",
    value: "2020322899",
    now: START,
    recheckDocuments: async (documentIds) => {
      queued.push(documentIds);
    },
  });
  assert.equal(outcome.ok, true);

  const filled = await itemOf(1, "delta-missing-dic");
  assert.equal(filled.fieldEditor.fields.dic, "2020322899");
  assert.equal(filled.fieldEditor.provenance.dic, "directory");

  const printed = await itemOf(2, "beta-printed-dic");
  assert.equal(printed.fieldEditor.fields.dic, "2020999999");
  assert.equal(printed.fieldEditor.provenance.dic, "extracted");

  assert.equal(queued.length, 1);
  assert.deepEqual([...queued[0]!].sort(), ["beta-printed-dic", "delta-missing-dic"]);
});

test("a refused correction changes nothing and records no event", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();
  const before = await subjectRow(alfaId);

  const badIcDph = await correctSubjectByHand({ subjectId: alfaId, field: "icDph", value: "SK2020322899", now: START });
  assert.deepEqual(badIcDph, { ok: false, message: "Slovenské IČ DPH musí byť deliteľné 11." });
  const emptyName = await correctSubjectByHand({ subjectId: alfaId, field: "legalName", value: "   ", now: START });
  assert.deepEqual(emptyName, { ok: false, message: "Názov nesmie byť prázdny." });
  const notCorrectable = await correctSubjectByHand({ subjectId: alfaId, field: "formerNames", value: "x", now: START });
  assert.equal(notCorrectable.ok, false);
  const unknown = await correctSubjectByHand({ subjectId: alfaId + 999, field: "address", value: "x", now: START });
  assert.equal(unknown.ok, false);

  assert.deepEqual(await subjectRow(alfaId), before);
  assert.equal((await getDb().select().from(events).where(eq(events.type, "SubjectCorrected"))).length, 0);
});

test("a correction to the value a field already has records nothing", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();
  const outcome = await correctSubjectByHand({ subjectId: alfaId, field: "legalName", value: "Alfa s.r.o.", now: START });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.changed, false);
  assert.equal((await getDb().select().from(events).where(eq(events.type, "SubjectCorrected"))).length, 0);
  assert.equal((await subjectRow(alfaId)).manualFieldsJson, "[]");
});

test("the VAT group is corrected like the other fields, and the detail shows it as manual", async () => {
  await seedTwoClients();
  const alfaId = await learnAlfa();
  const outcome = await correctSubjectByHand({ subjectId: alfaId, field: "vatGroupId", value: "sk 7120001713", now: START });
  assert.equal(outcome.ok, true);
  const detail = await loadSubjectDetail(alfaId);
  const group = detail!.fields.find((field) => field.field === "vatGroupId")!;
  assert.equal(group.value, "SK7120001713");
  assert.equal(group.sourceLabel, "ručne");
});
