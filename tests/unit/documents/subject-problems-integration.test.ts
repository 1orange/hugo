import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { ensureDocumentsForMonth, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, files, months } from "../../../src/lib/db/schema.ts";
import { buildMonthDocumentView, type DocumentListItem } from "../../../src/lib/documents/view.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import type { DirectoryDeps } from "../../../src/lib/subject-directory/service.ts";
import { verifyDocumentParties } from "../../../src/lib/subject-directory/verify-document.ts";
import { hasSubjectProblem } from "../../../src/modules/document-browser.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { freshTestDb } from "../support/test-db.ts";

// Her company: the client, on the customer side of a received invoice.
const CLIENT = { name: "Delta s.r.o.", ico: "31333532", dic: "2020311337", icDph: "SK2020311337" };
// The supplier's IČO is the register's; the printed name is not (a swapped or misread name).
const SUPPLIER_ICO = "31322832";
const SUPPLIER_PRINTED = "Alfa s.r.o.";
const RECEIVED = "02 Prijaté faktúry";
const ISSUED = "01 Vystavené faktúry";
const MONTH = "2026_02";
const START = "2026-02-01T00:00:00.000Z";

const INVOICE = "problem-invoice";
const OTHER = "problem-other";

function invoice(supplierName: string): ModelExtractedPayload {
  return {
    kind: "extracted",
    source: "model",
    parties: [
      { name: supplierName, ico: SUPPLIER_ICO, dic: "2020322832", icDph: null },
      { name: CLIENT.name, ico: CLIENT.ico, dic: CLIENT.dic, icDph: CLIENT.icDph },
    ],
    documentNumber: "FA-1",
    variableSymbol: "1",
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

/** The register knows the IČO under another legal name: the printed name is a mismatch. */
const REGISTER_ANSWER = {
  country: "SK" as const,
  ico: SUPPLIER_ICO,
  legalName: "Beta, a. s.",
  address: "Bratislava",
  dic: "2020322832",
  status: "active" as const,
};

function deps(register: FakeCompanyRegister, vat: FakeVatRegister): DirectoryDeps {
  return {
    register,
    vat,
    lock: new InProcessLookupLock(),
    limiter: createLookupRateLimiter({ perMinute: 1000 }),
    refreshDays: 30,
    now: () => START,
    waitMs: 5000,
  };
}

async function seed(): Promise<void> {
  await freshTestDb();
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: "problem-company", name: "Delta s.r.o.", active: true });
  await db.insert(months).values({
    id: 1,
    companyId: 1,
    monthKey: MONTH,
    driveFolderId: "problem-month",
    closedAt: null,
    openedAt: START,
  });
  for (const [driveFileId, slot, name] of [
    [INVOICE, RECEIVED, "invoice.pdf"],
    [OTHER, ISSUED, "issued.pdf"],
  ] as const) {
    await db.insert(files).values({
      driveFileId,
      companyId: 1,
      monthKey: MONTH,
      folderSlot: slot,
      parentId: `${driveFileId}-slot`,
      name,
      mimeType: "application/pdf",
      driveCreatedTime: START,
      firstSeenAt: START,
      lastSeenAt: START,
      deleted: false,
    });
  }
  await ensureDocumentsForMonth(1, MONTH, START);
  await writeExtractedPayload(INVOICE, invoice(SUPPLIER_PRINTED), "complete", null);
  await writeExtractedPayload(OTHER, invoice("Gama s.r.o."), "complete", null);
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

function itemOf(view: Awaited<ReturnType<typeof buildMonthDocumentView>>, id: string): DocumentListItem {
  const item = view!.documents.find((document) => document.id === id);
  assert.ok(item, `${id} is listed`);
  return item;
}

test("the rail and the export list show the stored mismatch, and building them calls no register or VIES", async () => {
  await seed();
  const register = new FakeCompanyRegister({ lookups: [REGISTER_ANSWER] });
  const vat = new FakeVatRegister();
  await verifyDocumentParties(INVOICE, deps(register, vat));
  const registerCalls = register.lookupCalls.length;
  const vatChecks = vat.checks.length;

  const view = await buildMonthDocumentView(1, MONTH, null, { key: "issueDate", direction: "desc" });

  const item = itemOf(view, INVOICE);
  assert.equal(item.fieldEditor.partyIntegrityStored, true, "the page reads the stored verdict");
  assert.equal(item.fieldEditor.partyIntegrity.supplier.verdict, "mismatch");
  assert.equal(hasSubjectProblem(item), true, "the rail marks the row");
  assert.equal(hasSubjectProblem(itemOf(view, OTHER)), false, "an unchecked party is not marked");
  assert.deepEqual(
    view!.subjectProblems.map((problem) => problem.id),
    [INVOICE],
    "the export warning lists the mismatched document",
  );
  assert.equal(register.lookupCalls.length, registerCalls, "building the view made no register call");
  assert.equal(vat.checks.length, vatChecks, "building the view made no VIES call");
});

test("a stored verdict that no longer matches the values is not shown: the offline verdict is, and nothing is marked", async () => {
  await seed();
  const register = new FakeCompanyRegister({ lookups: [REGISTER_ANSWER] });
  const vat = new FakeVatRegister();
  await verifyDocumentParties(INVOICE, deps(register, vat));
  // The printed supplier name changes without a check: the stored identity is stale.
  await writeExtractedPayload(INVOICE, invoice("Beta, a. s."), "complete", null);
  const registerCalls = register.lookupCalls.length;

  const view = await buildMonthDocumentView(1, MONTH, null, { key: "issueDate", direction: "desc" });

  const item = itemOf(view, INVOICE);
  assert.equal(item.fieldEditor.partyIntegrityStored, false, "offline verdict for the new values");
  assert.notEqual(item.fieldEditor.partyIntegrity.supplier.verdict, "mismatch");
  assert.equal(hasSubjectProblem(item), false);
  assert.deepEqual(view!.subjectProblems, []);
  assert.equal(register.lookupCalls.length, registerCalls, "the stale verdict is not re-checked while rendering");
});

test("an unavailable register is not a problem: nothing is marked, and the export list is empty", async () => {
  await seed();
  const register = new FakeCompanyRegister({ lookups: [REGISTER_ANSWER] });
  register.failure = new Error("RPO search failed: HTTP 503");
  await verifyDocumentParties(INVOICE, deps(register, new FakeVatRegister()));

  const view = await buildMonthDocumentView(1, MONTH, null, { key: "issueDate", direction: "desc" });

  assert.equal(itemOf(view, INVOICE).fieldEditor.partyIntegrity.supplier.verdict, "unavailable");
  assert.equal(hasSubjectProblem(itemOf(view, INVOICE)), false);
  assert.deepEqual(view!.subjectProblems, []);
});

test("a dismissed document with a mismatch is not listed for the export, which never sends it", async () => {
  await seed();
  const register = new FakeCompanyRegister({ lookups: [REGISTER_ANSWER] });
  await verifyDocumentParties(INVOICE, deps(register, new FakeVatRegister()));
  await getDb()
    .update(documents)
    .set({ decision: "not_relevant", decidedAt: START, notRelevantReason: "reklama" })
    .where(eq(documents.id, INVOICE));

  const view = await buildMonthDocumentView(1, MONTH, null, { key: "issueDate", direction: "desc" });

  assert.equal(hasSubjectProblem(itemOf(view, INVOICE)), true, "the rail still marks it");
  assert.deepEqual(view!.subjectProblems, []);
});

test("the export list is month-wide: a folder scope on the rail does not hide an affected document", async () => {
  await seed();
  const register = new FakeCompanyRegister({ lookups: [REGISTER_ANSWER] });
  await verifyDocumentParties(INVOICE, deps(register, new FakeVatRegister()));

  const scoped = await buildMonthDocumentView(1, MONTH, ISSUED, { key: "issueDate", direction: "desc" });

  assert.deepEqual(scoped!.documents.map((document) => document.id), [OTHER]);
  assert.deepEqual(scoped!.subjectProblems.map((problem) => problem.id), [INVOICE]);
  assert.equal(scoped!.homeCurrency, "EUR");
});
