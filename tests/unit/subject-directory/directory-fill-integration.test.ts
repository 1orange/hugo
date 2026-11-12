import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { listSubjectAliases } from "../../../src/adapters/store/subjects.ts";
import { ensureDocumentsForMonth, getDocument, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, files, months, subjects } from "../../../src/lib/db/schema.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
import { saveDocumentFields } from "../../../src/lib/documents/service.ts";
import { buildMonthDocumentView, type DocumentListItem } from "../../../src/lib/documents/view.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import {
  correctSubjectField,
  resolveSubject,
  verifyCounterparty,
  type DirectoryDeps,
} from "../../../src/lib/subject-directory/service.ts";
import { verifyDocumentParties } from "../../../src/lib/subject-directory/verify-document.ts";
import { parseConfirmedPayload } from "../../../src/modules/document-payload.ts";
import type { DocumentFieldFormInput, EditableDocumentFields } from "../../../src/modules/document-fields.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { offersRegisterTakeover } from "../../../src/modules/subject-integrity.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * The shared directory fills what a document lacks (ADR 0022): a missing DIČ or IČ DPH
 * of a known subject, marked `directory`; never a printed or typed value; derived,
 * not stored. And a printed name is an alias that later resolves its subject.
 */

const MONTH = "2026_04";
const START = "2026-04-06T08:00:00.000Z";
const FOLDER = "02 Prijaté faktúry";
const CLIENT = { name: "Delta s.r.o.", ico: "31333532", dic: "2020311337", icDph: "SK2020311337" };
const ALFA_FULL = { name: "Alfa s.r.o.", ico: "31322832", dic: "2020322832", icDph: "SK2020322832" };
const ALFA_REGISTER = {
  country: "SK" as const,
  ico: "31322832",
  legalName: "Alfa s.r.o.",
  address: "Bratislava",
  dic: "2020322832",
  status: "active" as const,
};
const CENTRAL_REGISTER = {
  country: "SK" as const,
  ico: "35757442",
  legalName: "Central Bratislava, a. s.",
  address: "Bratislava",
  dic: "2020357574",
  status: "active" as const,
};

let now = START;
const DAY = 24 * 60 * 60 * 1000;

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

function doc(documentId: string) {
  return { documentId };
}

async function seedCompany(): Promise<void> {
  await freshTestDb();
  now = START;
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: "fill-company", name: "Delta s.r.o.", active: true });
  await db.insert(months).values({
    id: 1,
    companyId: 1,
    monthKey: MONTH,
    driveFolderId: "fill-month",
    closedAt: null,
    openedAt: "2026-04-01T00:00:00.000Z",
  });
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

function invoice(supplier: ModelExtractedPayload["parties"][number]): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [supplier, { name: CLIENT.name, ico: CLIENT.ico, dic: CLIENT.dic, icDph: CLIENT.icDph }],
    documentNumber: "FA-4",
    variableSymbol: "4",
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

async function addInvoice(id: string, supplier: ModelExtractedPayload["parties"][number]): Promise<void> {
  await getDb().insert(files).values({
    driveFileId: id,
    companyId: 1,
    monthKey: MONTH,
    folderSlot: FOLDER,
    parentId: "fill-slot-02",
    name: `${id}.pdf`,
    mimeType: "application/pdf",
    driveCreatedTime: START,
    firstSeenAt: START,
    lastSeenAt: START,
    deleted: false,
  });
  await ensureDocumentsForMonth(1, MONTH, START);
  await writeExtractedPayload(id, invoice(supplier), "complete", null);
  // The extraction pipeline stamps the version it read with; enrichment applies to that contract.
  await getDb()
    .update(documents)
    .set({ extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION })
    .where(eq(documents.id, id));
}

async function itemOf(id: string): Promise<DocumentListItem> {
  const view = await buildMonthDocumentView(1, MONTH);
  const item = view!.documents.find((document) => document.id === id);
  assert.ok(item, `${id} is listed`);
  return item;
}

function formFrom(fields: EditableDocumentFields, overrides: Partial<DocumentFieldFormInput> = {}): DocumentFieldFormInput {
  return {
    exportSection: "",
    supplierName: fields.supplierName,
    ico: fields.ico,
    dic: fields.dic,
    icDph: fields.icDph,
    customerName: fields.customerName,
    customerIco: fields.customerIco,
    customerDic: fields.customerDic,
    customerIcDph: fields.customerIcDph,
    documentNumber: fields.documentNumber,
    variableSymbol: fields.variableSymbol,
    issueDateRaw: fields.issueDateRaw,
    taxableSupplyDateRaw: fields.taxableSupplyDateRaw,
    dueDateRaw: fields.dueDateRaw,
    receiptNumber: fields.receiptNumber,
    receiptTimestampRaw: fields.receiptTimestampRaw,
    currency: fields.currency,
    amountLiteral: fields.amountLiteral,
    recapBaseLiteral: fields.recapBaseLiteral,
    recapVatLiteral: fields.recapVatLiteral,
    vatRecap: fields.vatRecap.map((row) => ({
      rateLiteral: row.rateLiteral,
      baseLiteral: row.baseLiteral,
      vatLiteral: row.vatLiteral,
    })),
    ...overrides,
  };
}

/** Teaches the directory Alfa: its register answer, and VIES's answer for its IČ DPH. */
async function learnAlfa(register: FakeCompanyRegister, vat: FakeVatRegister): Promise<number> {
  const check = await verifyCounterparty(ALFA_FULL, deps(register, vat), doc("learned-alfa"));
  assert.ok(check.subjectId !== null);
  return check.subjectId!;
}

test("a missing DIČ and IČ DPH of a known subject are filled from the directory, and marked as its", async () => {
  await seedCompany();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  const vat = new FakeVatRegister({ SK2020322832: "Alfa s.r.o." });
  await learnAlfa(register, vat);
  // The counterparty prints its IČO and name only.
  await addInvoice("fill-a", { name: "Alfa s.r.o.", ico: "31322832", dic: "", icDph: "" });

  const item = await itemOf("fill-a");

  assert.equal(item.fieldEditor.fields.dic, "2020322832");
  assert.equal(item.fieldEditor.provenance.dic, "directory");
  assert.equal(item.fieldEditor.fields.icDph, "SK2020322832");
  assert.equal(item.fieldEditor.provenance.icDph, "directory");
  assert.equal(item.fieldEditor.provenance.ico, "extracted", "the printed IČO is the printed one");
  assert.equal(item.fieldEditor.provenance.supplierName, "extracted");
});

test("a printed value that conflicts with the directory stays, and the verdict names the register's", async () => {
  await seedCompany();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  const vat = new FakeVatRegister({ SK2020322832: "Alfa s.r.o." });
  await learnAlfa(register, vat);
  await addInvoice("fill-c", { name: "Alfa s.r.o.", ico: "31322832", dic: "2020999999", icDph: "" });

  const item = await itemOf("fill-c");
  assert.equal(item.fieldEditor.fields.dic, "2020999999", "the printed DIČ is not replaced");
  assert.equal(item.fieldEditor.provenance.dic, "extracted");
  assert.equal(item.fieldEditor.fields.icDph, "SK2020322832", "the missing IČ DPH still fills");

  const record = await verifyDocumentParties("fill-c", deps(register, vat));
  assert.equal(record?.supplier.verdict, "mismatch");
  // The register's DIČ is named; the filled IČ DPH no longer agrees with the printed DIČ, which the offline check says.
  assert.deepEqual(
    record?.supplier.findings
      .filter((finding) => finding.severity === "mismatch")
      .map((finding) => [finding.code, finding.expected]),
    [["register-dic", "2020322832"]],
  );
  assert.equal(offersRegisterTakeover(record!.supplier), true);
});

test("a page builds without a register or VIES call", async () => {
  await seedCompany();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  const vat = new FakeVatRegister({ SK2020322832: "Alfa s.r.o." });
  await learnAlfa(register, vat);
  await addInvoice("fill-b", { name: "Alfa s.r.o.", ico: "31322832", dic: "", icDph: "" });
  await verifyDocumentParties("fill-b", deps(register, vat));
  const calls = register.lookupCalls.length;
  const vatChecks = vat.checks.length;

  await buildMonthDocumentView(1, MONTH);
  await itemOf("fill-b");

  assert.equal(register.lookupCalls.length, calls);
  assert.equal(vat.checks.length, vatChecks);
});

test("typed values survive re-extraction and a refresh of the directory; untouched fills stay derived", async () => {
  await seedCompany();
  let register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  const vat = new FakeVatRegister({ SK2020322832: "Alfa s.r.o." });
  const subjectId = await learnAlfa(register, vat);
  const supplier = { name: "Alfa s.r.o.", ico: "31322832", dic: "", icDph: "" };
  await addInvoice("fill-d", supplier);

  // She types a DIČ and saves the whole form as the panel does, with the IČ DPH the directory filled.
  const shown = await itemOf("fill-d");
  assert.equal(shown.fieldEditor.provenance.icDph, "directory");
  assert.deepEqual(
    await saveDocumentFields({
      companyId: 1,
      monthKey: MONTH,
      documentId: "fill-d",
      fields: formFrom(shown.fieldEditor.fields, { dic: "2020111111" }),
    }),
    { ok: true },
  );
  const stored = parseConfirmedPayload((await getDocument("fill-d"))!.confirmedPayloadJson);
  assert.equal(stored.dic, "2020111111");
  assert.equal(stored.icDph, undefined, "the directory's IČ DPH is derived, not stored");

  const typed = await itemOf("fill-d");
  assert.equal(typed.fieldEditor.fields.dic, "2020111111");
  assert.equal(typed.fieldEditor.provenance.dic, "confirmed");
  assert.equal(typed.fieldEditor.provenance.icDph, "directory");

  // A re-extraction of the same file, with the same printed values.
  await writeExtractedPayload("fill-d", invoice(supplier), "complete", null);
  assert.equal((await itemOf("fill-d")).fieldEditor.fields.dic, "2020111111");

  // The directory's subject is corrected: the derived IČ DPH follows it, the typed DIČ does not move.
  await correctSubjectField(subjectId, "icDph", "SK2020322899", START);
  const refreshed = await itemOf("fill-d");
  assert.equal(refreshed.fieldEditor.fields.icDph, "SK2020322899");
  assert.equal(refreshed.fieldEditor.provenance.icDph, "directory");
  assert.equal(refreshed.fieldEditor.fields.dic, "2020111111");

  // A register refresh that changes the subject's DIČ: still the typed one.
  register = new FakeCompanyRegister({ lookups: [{ ...ALFA_REGISTER, dic: "2020322999" }] });
  now = later(31);
  await verifyCounterparty(ALFA_FULL, deps(register, vat), doc("refresh"));
  assert.equal((await getDb().select().from(subjects))[0]!.dic, "2020322999");
  assert.equal((await itemOf("fill-d")).fieldEditor.fields.dic, "2020111111");
});

test("saving the form as shown stores nothing the directory fills or nothing printed: the fills stay possible", async () => {
  await seedCompany();
  const register = new FakeCompanyRegister({ lookups: [ALFA_REGISTER] });
  const vat = new FakeVatRegister({ SK2020322832: "Alfa s.r.o." });
  await learnAlfa(register, vat);
  await addInvoice("fill-e", { name: "Alfa s.r.o.", ico: "31322832", dic: "", icDph: "" });

  // The panel saves every field: the filled ones unchanged, the printed-nothing ones still empty.
  const shown = await itemOf("fill-e");
  assert.deepEqual(
    await saveDocumentFields({
      companyId: 1,
      monthKey: MONTH,
      documentId: "fill-e",
      fields: formFrom(shown.fieldEditor.fields, { documentNumber: "FA-4b" }),
    }),
    { ok: true },
  );
  const stored = parseConfirmedPayload((await getDocument("fill-e"))!.confirmedPayloadJson);
  assert.equal(stored.dic, undefined);
  assert.equal(stored.icDph, undefined);

  const after = await itemOf("fill-e");
  assert.equal(after.fieldEditor.provenance.dic, "directory");
  assert.equal(after.fieldEditor.provenance.icDph, "directory");
});

test("a printed name counts once per document and a later party without an IČO resolves to the same subject", async () => {
  await seedCompany();
  const register = new FakeCompanyRegister({ lookups: [CENTRAL_REGISTER] });
  const vat = new FakeVatRegister();
  const printed = { name: "CENTRAL Bratislava", ico: "35757442", dic: "2020357574", icDph: "" };

  const first = await verifyCounterparty(printed, deps(register, vat), doc("central-1"));
  assert.ok(first.subjectId !== null);
  const aliasCount = async () =>
    (await listSubjectAliases(first.subjectId!)).find((alias) => alias.displayName === "CENTRAL Bratislava")?.count;

  assert.equal(await aliasCount(), 1, "a party with an IČO records its printed name too");

  await verifyCounterparty(printed, deps(register, vat), doc("central-1"));
  assert.equal(await aliasCount(), 1, "checking the same document again does not count it twice");

  await verifyCounterparty(printed, deps(register, vat), doc("central-2"));
  assert.equal(await aliasCount(), 2, "a second document is a second sighting");

  const resolved = await resolveSubject({ name: "CENTRAL Bratislava", ico: "", dic: "", icDph: "" });
  assert.equal(resolved?.id, first.subjectId);

  const later = await verifyCounterparty({ name: "CENTRAL Bratislava", ico: "", dic: "", icDph: "" }, deps(register, vat), doc("central-3"));
  assert.equal(later.subjectId, first.subjectId);
  assert.equal(register.lookupCalls.length, 1, "the alias needed no register");
});
