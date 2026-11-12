import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, files, months, partners } from "../../../src/lib/db/schema.ts";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { ensureDocumentsForMonth, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { confirmDocument, saveDocumentFields } from "../../../src/lib/documents/service.ts";
import { buildMonthOmegaExport } from "../../../src/lib/omega-export/service.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import { verifyCounterparty, type DirectoryDeps } from "../../../src/lib/subject-directory/service.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
import type { DocumentFieldFormInput } from "../../../src/modules/document-fields.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * The Omega export carries the effective values (ADR 0022): a DIČ the directory
 * fills for a counterparty is exported, and a DIČ she typed is exported over it.
 */

const MONTH = "2026_05";
const NOW = "2026-05-21T10:00:00.000Z";
const ALFA = { name: "Alfa s.r.o.", ico: "31322832", dic: "2020322832", icDph: "SK2020322832" };

function deps(register: FakeCompanyRegister, vat: FakeVatRegister): DirectoryDeps {
  return {
    register,
    vat,
    lock: new InProcessLookupLock(),
    limiter: createLookupRateLimiter({ perMinute: 1000 }),
    refreshDays: 30,
    now: () => NOW,
    waitMs: 5000,
  };
}

async function seedCompany(): Promise<number> {
  await freshTestDb();
  const db = getDb();
  const [company] = await db
    .insert(companies)
    .values({ driveFolderId: "omega-directory", name: "Acme s.r.o.", active: true })
    .returning({ id: companies.id });
  await db.insert(months).values({
    companyId: company!.id,
    monthKey: MONTH,
    driveFolderId: "omega-month",
    closedAt: null,
    openedAt: "2026-05-01T00:00:00.000Z",
  });
  return company!.id;
}

/** A received invoice whose counterparty prints its IČO and name, and nothing else. */
async function seedInvoice(companyId: number, id: string, supplierDic: string): Promise<void> {
  await getDb().insert(files).values({
    driveFileId: id,
    companyId,
    monthKey: MONTH,
    folderSlot: "02 Prijaté faktúry",
    parentId: "omega-slot-02",
    name: `${id}.pdf`,
    mimeType: "application/pdf",
    driveCreatedTime: NOW,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    deleted: false,
  });
  await ensureDocumentsForMonth(companyId, MONTH, NOW);
  const extraction: ModelExtractedPayload = {
    kind: "extracted",
    source: "model",
    parties: [
      { name: ALFA.name, ico: ALFA.ico, dic: supplierDic, icDph: "" },
      { name: "Acme s.r.o.", ico: "35757442", dic: "2020357574", icDph: "" },
    ],
    documentNumber: `FA-${id}`,
    variableSymbol: id,
    issueDate: "2026-05-18",
    taxableSupplyDate: null,
    dueDate: "2026-06-18",
    currency: "EUR",
    amountCents: 12300,
    amountLiteral: "123.00",
    vatRecap: [{ rateLiteral: "23", baseLiteral: "100.00", baseCents: 10000, vatLiteral: "23.00", vatCents: 2300 }],
    docTypeHint: "invoice",
  };
  await writeExtractedPayload(id, extraction, "complete", null);
  await getDb()
    .update(documents)
    .set({ extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION })
    .where(eq(documents.id, id));
}

async function partnerDic(companyId: number, ico: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select()
    .from(partners)
    .where(eq(partners.companyId, companyId));
  assert.equal(row?.ico, ico);
  return row?.dic;
}

test("the export carries the DIČ the directory fills for a counterparty whose invoice does not print one", async () => {
  const companyId = await seedCompany();
  const register = new FakeCompanyRegister({
    lookups: [{ country: "SK", ico: ALFA.ico, legalName: ALFA.name, address: "Bratislava", dic: ALFA.dic, status: "active" }],
  });
  const vat = new FakeVatRegister({ [ALFA.icDph]: ALFA.name });
  // The directory learns Alfa from another document, with its full identifiers.
  await verifyCounterparty(ALFA, deps(register, vat), { documentId: "learned" });
  await seedInvoice(companyId, "omega-a", "");
  assert.deepEqual(
    await confirmDocument({ companyId, monthKey: MONTH, documentId: "omega-a", confirmed: true, now: NOW }),
    { ok: true },
  );

  const { preview } = await buildMonthOmegaExport({
    companyId,
    monthKey: MONTH,
    register: new FakeCompanyRegister({ lookups: [] }),
    now: NOW,
    persist: false,
  });

  assert.equal(preview.included.length, 1);
  assert.equal(await partnerDic(companyId, ALFA.ico), ALFA.dic);
});

test("a DIČ she typed is exported over the directory's", async () => {
  const companyId = await seedCompany();
  const register = new FakeCompanyRegister({
    lookups: [{ country: "SK", ico: ALFA.ico, legalName: ALFA.name, address: "Bratislava", dic: ALFA.dic, status: "active" }],
  });
  await verifyCounterparty(ALFA, deps(register, new FakeVatRegister()), { documentId: "learned" });
  await seedInvoice(companyId, "omega-b", "");
  const typed: DocumentFieldFormInput = {
    exportSection: "",
    supplierName: ALFA.name,
    ico: ALFA.ico,
    dic: "2020111111",
    icDph: "",
    customerName: "",
    customerIco: "",
    customerDic: "",
    customerIcDph: "",
    documentNumber: "FA-omega-b",
    variableSymbol: "omega-b",
    issueDateRaw: "18.05.2026",
    taxableSupplyDateRaw: "",
    dueDateRaw: "18.06.2026",
    receiptNumber: "",
    receiptTimestampRaw: "",
    currency: "EUR",
    amountLiteral: "123.00",
    recapBaseLiteral: "100.00",
    recapVatLiteral: "23.00",
    vatRecap: [{ rateLiteral: "23", baseLiteral: "100.00", vatLiteral: "23.00" }],
  };
  assert.deepEqual(
    await saveDocumentFields({ companyId, monthKey: MONTH, documentId: "omega-b", fields: typed }),
    { ok: true },
  );
  assert.deepEqual(
    await confirmDocument({ companyId, monthKey: MONTH, documentId: "omega-b", confirmed: true, now: NOW }),
    { ok: true },
  );

  await buildMonthOmegaExport({
    companyId,
    monthKey: MONTH,
    register: new FakeCompanyRegister({ lookups: [] }),
    now: NOW,
    persist: false,
  });

  assert.equal(await partnerDic(companyId, ALFA.ico), "2020111111");
});
