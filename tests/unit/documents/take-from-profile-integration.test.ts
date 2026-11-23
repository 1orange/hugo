import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { ensureDocumentsForMonth, getDocument, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, events, files, months } from "../../../src/lib/db/schema.ts";
import {
  confirmDocument,
  saveDocumentFields,
  takePartyFromProfile,
} from "../../../src/lib/documents/service.ts";
import { buildMonthDocumentView, type DocumentListItem } from "../../../src/lib/documents/view.ts";
import { MemorySubjectVerificationQueue } from "../../../src/adapters/job-queue/memory-subject-verification-queue.ts";
import { useSubjectVerificationQueue } from "../../../src/lib/subject-directory/queue.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import type { DirectoryDeps } from "../../../src/lib/subject-directory/service.ts";
import { verifyDocumentParties } from "../../../src/lib/subject-directory/verify-document.ts";
import type { DocumentFieldFormInput, EditableDocumentFields } from "../../../src/modules/document-fields.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * *Prevziať z profilu* (PRD 0007, issue 14): her own party, judged against her
 * profile, takes the profile's values, IČO included, with the `profile` badge;
 * the verdict is judged again. Mirrors the register takeover's tests.
 */

const COMPANY_FOLDER = "profile-take-company";
const MONTH_FOLDER = "profile-take-month";
const SLOT_02 = "profile-take-slot-02";
const INVOICE = "profile-take-invoice";
const MONTH = "2026_03";
const START = "2026-03-10T10:00:00.000Z";

// Her company, as her profile holds it.
const CLIENT = { name: "Delta s.r.o.", ico: "31333532", dic: "2020311337", icDph: "SK2020311337" };
// The same company as the invoice prints it: a wrong name, IČO, DIČ and IČ DPH.
const MISPRINTED_CLIENT = { name: "Delta Trade s.r.o.", ico: "31333999", dic: "2020311999", icDph: "SK2020311999" };
// The counterparty, which the register knows and which is not her profile's to correct.
const PRINTED_SUPPLIER = { name: "Alfa Holding s.r.o.", ico: "31322832", dic: "2020322832", icDph: "SK2020322832" };
const REGISTER_ALFA = {
  country: "SK" as const,
  ico: "31322832",
  legalName: "Alfa s.r.o.",
  address: "Bratislava",
  dic: "2020322832",
  status: "active" as const,
};

// Folder 02 is received invoices: the counterparty is the supplier, her company the customer.
function extractionWith(customer: typeof CLIENT | typeof MISPRINTED_CLIENT): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [PRINTED_SUPPLIER, customer],
    documentNumber: "FA-3",
    variableSymbol: "3",
    issueDate: "2026-03-09",
    taxableSupplyDate: null,
    dueDate: null,
    currency: "EUR",
    amountCents: 12000,
    amountLiteral: "120.00",
    vatRecap: [],
    docTypeHint: "invoice",
  };
}

let now = START;

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

async function seedInvoice(
  extraction: ModelExtractedPayload = extractionWith(MISPRINTED_CLIENT),
  profile: { dic: string } = { dic: CLIENT.dic },
): Promise<void> {
  await freshTestDb();
  now = START;
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: COMPANY_FOLDER, name: "Delta s.r.o.", active: true });
  await db.insert(months).values({
    id: 1,
    companyId: 1,
    monthKey: MONTH,
    driveFolderId: MONTH_FOLDER,
    closedAt: null,
    openedAt: "2026-03-01T00:00:00.000Z",
  });
  await db.insert(files).values({
    driveFileId: INVOICE,
    companyId: 1,
    monthKey: MONTH,
    folderSlot: "02 Prijaté faktúry",
    parentId: SLOT_02,
    name: "invoice.pdf",
    mimeType: "application/pdf",
    driveCreatedTime: START,
    firstSeenAt: START,
    lastSeenAt: START,
    deleted: false,
  });
  await ensureDocumentsForMonth(1, MONTH, START);
  await writeExtractedPayload(INVOICE, extraction, "complete", null);
  await saveCompanyProfile(1, {
    country: "SK",
    legalName: CLIENT.name,
    address: "Bratislava",
    ico: CLIENT.ico,
    dic: profile.dic,
    icDph: CLIENT.icDph,
    registerSource: "fake",
    savedAt: START,
  });
}

/** The register knows Alfa under its legal name, and VIES holds its IČ DPH under that name. */
function registers(): { register: FakeCompanyRegister; vat: FakeVatRegister } {
  return {
    register: new FakeCompanyRegister({ lookups: [REGISTER_ALFA] }),
    vat: new FakeVatRegister({ SK2020322832: "Alfa s.r.o." }),
  };
}

async function invoiceItem(): Promise<DocumentListItem> {
  const view = await buildMonthDocumentView(1, MONTH);
  const item = view!.documents.find((document) => document.id === INVOICE);
  assert.ok(item, "invoice is listed");
  return item;
}

function formFrom(fields: EditableDocumentFields): DocumentFieldFormInput {
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
  };
}

async function takeEvents() {
  return getDb().select().from(events).where(eq(events.type, "PartyTakenFromProfile"));
}

function take(side: "supplier" | "customer" = "customer") {
  return takePartyFromProfile({ companyId: 1, monthKey: MONTH, documentId: INVOICE, side, now: START });
}

test("taking the profile's values writes name, IČO, DIČ and IČ DPH as hers, with the profile badge, and clears the mismatch", async () => {
  await seedInvoice();
  const { register, vat } = registers();
  const queue = new MemorySubjectVerificationQueue();
  useSubjectVerificationQueue(queue);
  try {
    const stored = await verifyDocumentParties(INVOICE, deps(register, vat));
    assert.equal(stored?.customer.verdict, "mismatch");
    assert.deepEqual(
      stored?.customer.findings
        .filter((finding) => finding.code.startsWith("profile-"))
        .map((finding) => [finding.code, finding.expected])
        .sort(),
      [
        ["profile-dic", CLIENT.dic],
        ["profile-icdph", CLIENT.icDph],
        ["profile-ico", CLIENT.ico],
        ["profile-name", CLIENT.name],
      ],
    );
    const before = await invoiceItem();
    assert.equal(before.fieldEditor.partyIntegrityStored, true);
    queue.jobs.clear();

    assert.deepEqual(await take("customer"), { ok: true });

    const after = await invoiceItem();
    assert.equal(after.fieldEditor.fields.customerName, CLIENT.name);
    assert.equal(after.fieldEditor.fields.customerIco, CLIENT.ico, "the IČO is written too");
    assert.equal(after.fieldEditor.fields.customerDic, CLIENT.dic);
    assert.equal(after.fieldEditor.fields.customerIcDph, CLIENT.icDph);
    assert.equal(after.fieldEditor.provenance.customerName, "profile");
    assert.equal(after.fieldEditor.provenance.customerIco, "profile");
    assert.equal(after.fieldEditor.provenance.customerDic, "profile");
    assert.equal(after.fieldEditor.provenance.customerIcDph, "profile");
    assert.equal(after.fieldEditor.fields.supplierName, PRINTED_SUPPLIER.name, "the other party is untouched");
    assert.equal(after.fieldEditor.provenance.supplierName, "extracted");

    const taken = await takeEvents();
    assert.equal(taken.length, 1);
    assert.deepEqual(JSON.parse(taken[0]!.payloadJson), {
      monthKey: MONTH,
      driveFileId: INVOICE,
      documentId: INVOICE,
      side: "customer",
    });
    assert.deepEqual([...queue.jobs.keys()], [INVOICE], "the changed identity is checked again");

    const rechecked = await verifyDocumentParties(INVOICE, deps(register, vat));
    assert.equal(rechecked?.customer.verdict, "verified");
    assert.deepEqual(rechecked?.customer.findings, []);
    const shown = await invoiceItem();
    assert.equal(shown.fieldEditor.partyIntegrityStored, true);
    assert.equal(shown.fieldEditor.partyIntegrity.customer.verdict, "verified");
  } finally {
    useSubjectVerificationQueue(null);
  }
});

test("a profile without a DIČ writes only what it holds; the party's own DIČ stays", async () => {
  await seedInvoice(extractionWith(MISPRINTED_CLIENT), { dic: "" });
  const { register, vat } = registers();
  const stored = await verifyDocumentParties(INVOICE, deps(register, vat));
  assert.equal(stored?.customer.verdict, "mismatch");
  assert.equal(stored?.customer.findings.some((finding) => finding.code === "profile-dic"), false);

  assert.deepEqual(await take("customer"), { ok: true });

  const after = await invoiceItem();
  assert.equal(after.fieldEditor.fields.customerName, CLIENT.name);
  assert.equal(after.fieldEditor.fields.customerIco, CLIENT.ico);
  assert.equal(after.fieldEditor.fields.customerDic, MISPRINTED_CLIENT.dic, "the profile holds no DIČ to write");
  assert.equal(after.fieldEditor.provenance.customerDic, "extracted");
  assert.equal(after.fieldEditor.provenance.customerName, "profile");
});

test("a value she types after taking one from the profile is hers again", async () => {
  await seedInvoice();
  const { register, vat } = registers();
  await verifyDocumentParties(INVOICE, deps(register, vat));
  assert.deepEqual(await take("customer"), { ok: true });

  const item = await invoiceItem();
  assert.deepEqual(
    await saveDocumentFields({
      companyId: 1,
      monthKey: MONTH,
      documentId: INVOICE,
      fields: formFrom({ ...item.fieldEditor.fields, customerName: "Delta, a. s." }),
    }),
    { ok: true },
  );

  const edited = await invoiceItem();
  assert.equal(edited.fieldEditor.fields.customerName, "Delta, a. s.");
  assert.equal(edited.fieldEditor.provenance.customerName, "confirmed");
  assert.equal(edited.fieldEditor.provenance.customerIco, "profile", "the untouched values keep their badge");
});

test("taking from the profile works on a decided document too, as its fields can be edited", async () => {
  await seedInvoice();
  const { register, vat } = registers();
  await verifyDocumentParties(INVOICE, deps(register, vat));
  assert.deepEqual(
    await confirmDocument({ companyId: 1, monthKey: MONTH, documentId: INVOICE, confirmed: true, now: START }),
    { ok: true },
  );
  const before = await getDocument(INVOICE);

  const result = await take("customer");

  assert.equal(result.ok, true);
  const after = await getDocument(INVOICE);
  assert.notEqual(after!.confirmedPayloadJson, before!.confirmedPayloadJson);
  assert.equal(after!.decision, "confirmed", "the decision stands");
  assert.equal((await takeEvents()).length, 1);
});

test("taking from the profile is refused on an exported document and in a closed month", async () => {
  await seedInvoice();
  const { register, vat } = registers();
  await verifyDocumentParties(INVOICE, deps(register, vat));
  await getDb().update(documents).set({ exportedAt: "2026-03-20T00:00:00.000Z" }).where(eq(documents.id, INVOICE));
  assert.equal((await take("customer")).ok, false);

  await getDb().update(documents).set({ exportedAt: null }).where(eq(documents.id, INVOICE));
  await getDb().update(months).set({ closedAt: "2026-03-31T00:00:00.000Z" }).where(eq(months.id, 1));
  assert.equal((await take("customer")).ok, false);
  assert.equal((await takeEvents()).length, 0);
});

test("a party that agrees with the profile has nothing to take from it", async () => {
  await seedInvoice(extractionWith(CLIENT));
  const { register, vat } = registers();
  const stored = await verifyDocumentParties(INVOICE, deps(register, vat));
  assert.equal(stored?.customer.verdict, "verified");

  assert.equal((await take("customer")).ok, false);
  assert.equal((await takeEvents()).length, 0);
});

test("a counterparty the register contradicts is not the profile's to correct", async () => {
  await seedInvoice(extractionWith(CLIENT));
  const { register, vat } = registers();
  const stored = await verifyDocumentParties(INVOICE, deps(register, vat));
  assert.equal(stored?.supplier.verdict, "mismatch", "the register holds a different name for the counterparty");

  assert.equal((await take("supplier")).ok, false);
  assert.equal((await takeEvents()).length, 0);
});

test("a verdict judged for values she has since changed is not taken from", async () => {
  await seedInvoice();
  const { register, vat } = registers();
  await verifyDocumentParties(INVOICE, deps(register, vat));
  const item = await invoiceItem();
  assert.deepEqual(
    await saveDocumentFields({
      companyId: 1,
      monthKey: MONTH,
      documentId: INVOICE,
      fields: formFrom({ ...item.fieldEditor.fields, customerName: "Gamma s.r.o." }),
    }),
    { ok: true },
  );

  assert.equal((await take("customer")).ok, false, "the stored verdict is for the old name");
  assert.equal((await takeEvents()).length, 0);
});
