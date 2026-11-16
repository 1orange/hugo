import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, files, months, partners } from "../../../src/lib/db/schema.ts";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import type { RegisterLookup } from "../../../src/modules/company-profile.ts";
import { FakeVatRegister } from "../../../src/adapters/vat-register/fake-vat-register.ts";
import { ensureDocumentsForMonth, writeExtractedPayload } from "../../../src/adapters/store/documents.ts";
import { findSubjectByIco } from "../../../src/adapters/store/subjects.ts";
import { confirmDocument } from "../../../src/lib/documents/service.ts";
import { buildMonthOmegaExport } from "../../../src/lib/omega-export/service.ts";
import { InProcessLookupLock } from "../../../src/lib/subject-directory/lookup-lock.ts";
import { createLookupRateLimiter } from "../../../src/lib/subject-directory/rate-limit.ts";
import {
  correctSubjectField,
  verifyCounterparty,
  type DirectoryDeps,
} from "../../../src/lib/subject-directory/service.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * The Omega export's partner details come from the subject directory first (ADR 0019,
 * ADR 0022): a known, fresh subject is exported with no register call; an unknown or
 * stale one is looked up through the directory, once, and recorded there. The
 * per-company partner list stays the record of what was exported for each client.
 */

const MONTH = "2026_05";
const NOW = "2026-05-21T10:00:00.000Z";
const LONG_AGO = "2026-01-01T00:00:00.000Z";

type Party = { name: string; ico: string; dic: string; icDph: string; address: string };

const ALFA: Party = {
  name: "Alfa s.r.o.",
  ico: "31322832",
  dic: "2020322832",
  icDph: "",
  address: "Pribinova 25, 811 09 Bratislava",
};
const BETA: Party = {
  name: "Beta s.r.o.",
  ico: "31333532",
  dic: "2020311335",
  icDph: "",
  address: "Hlavná 12, 040 01 Košice",
};
const DELTA: Party = {
  name: "Delta s.r.o.",
  ico: "45555555",
  dic: "2045555555",
  icDph: "",
  address: "Trnavská 3, 831 04 Bratislava",
};
/** Known to neither the register fixture nor the directory until a test says so. */
const GAMMA: Party = {
  name: "Gamma s.r.o.",
  ico: "44444444",
  dic: "2044444444",
  icDph: "",
  address: "Lúčna 9, 851 01 Bratislava",
};

function registered(party: Party, overrides: Partial<RegisterLookup> = {}): RegisterLookup {
  return {
    country: "SK",
    ico: party.ico,
    legalName: party.name,
    address: party.address,
    dic: party.dic,
    status: "active",
    ...overrides,
  };
}

function deps(register: FakeCompanyRegister, now = NOW, perMinute = 1000): DirectoryDeps {
  return {
    register,
    vat: new FakeVatRegister(),
    lock: new InProcessLookupLock(),
    limiter: createLookupRateLimiter({ perMinute }),
    refreshDays: 30,
    now: () => now,
    waitMs: 5000,
  };
}

async function seedCompany(name: string, folder: string): Promise<number> {
  const db = getDb();
  const [company] = await db
    .insert(companies)
    .values({ driveFolderId: folder, name, active: true })
    .returning({ id: companies.id });
  await db.insert(months).values({
    companyId: company!.id,
    monthKey: MONTH,
    driveFolderId: `${folder}-month`,
    closedAt: null,
    openedAt: "2026-05-01T00:00:00.000Z",
  });
  return company!.id;
}

/** A received invoice from `supplier` to Acme; the supplier is the counterparty of the export. */
async function seedReceived(companyId: number, id: string, supplier: Party): Promise<void> {
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
      { name: supplier.name, ico: supplier.ico, dic: supplier.dic, icDph: supplier.icDph },
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

async function seedAndConfirm(companyId: number, id: string, supplier: Party): Promise<void> {
  await seedReceived(companyId, id, supplier);
  assert.deepEqual(
    await confirmDocument({ companyId, monthKey: MONTH, documentId: id, confirmed: true, now: NOW }),
    { ok: true },
  );
}

/** Makes a counterparty known to the directory, as an earlier document's check would. */
async function learn(party: Party, directory: DirectoryDeps): Promise<void> {
  await verifyCounterparty(
    { name: party.name, ico: party.ico, dic: party.dic, icDph: party.icDph },
    directory,
    { documentId: `learned-${party.ico}` },
  );
}

async function exportMonth(companyId: number, directory: DirectoryDeps | null) {
  return buildMonthOmegaExport({
    companyId,
    monthKey: MONTH,
    directory,
    now: NOW,
    persist: false,
  });
}

async function partnerOf(companyId: number, ico: string) {
  const [row] = await getDb()
    .select()
    .from(partners)
    .where(and(eq(partners.companyId, companyId), eq(partners.ico, ico)));
  assert.ok(row, `the per-company partner list holds ${ico}`);
  return row;
}

test("a month whose partners are all known to the directory makes no register call", async () => {
  await freshTestDb();
  const companyId = await seedCompany("Acme", "partners-known");
  const learner = new FakeCompanyRegister({ lookups: [registered(ALFA), registered(BETA)] });
  await learn(ALFA, deps(learner));
  await learn(BETA, deps(learner));

  await seedAndConfirm(companyId, "doc-alfa", { ...ALFA, name: "ALFA, s.r.o." });
  await seedAndConfirm(companyId, "doc-beta", { ...BETA, name: "Beta, s.r.o." });

  const register = new FakeCompanyRegister({ lookups: [] });
  const { preview } = await exportMonth(companyId, deps(register));

  assert.equal(preview.included.length, 2);
  assert.deepEqual(register.lookupCalls, []);

  const alfa = await partnerOf(companyId, ALFA.ico);
  assert.equal(alfa.legalName, ALFA.name, "the directory's legal name, not the printed one");
  assert.equal(alfa.street, "Pribinova 25");
  assert.equal(alfa.psc, "811 09");
  assert.equal(alfa.city, "Bratislava");
  assert.equal(alfa.dic, ALFA.dic);
});

test("an unknown partner is looked up once, stored in the directory and exported", async () => {
  await freshTestDb();
  const companyId = await seedCompany("Acme", "partners-unknown");
  await seedAndConfirm(companyId, "doc-delta", { ...DELTA, name: "Delta, s.r.o.", dic: "" });

  const register = new FakeCompanyRegister({ lookups: [registered(DELTA)] });
  const first = await exportMonth(companyId, deps(register));
  assert.equal(first.preview.included.length, 1);
  assert.deepEqual(register.lookupCalls.map((call) => call.ico), [DELTA.ico]);

  const stored = await findSubjectByIco("SK", DELTA.ico);
  assert.ok(stored, "the answer is recorded in the directory");
  assert.equal(stored.legalName, DELTA.name);
  assert.equal(stored.address, DELTA.address);
  assert.equal(stored.dic, DELTA.dic);

  const second = await exportMonth(companyId, deps(register));
  assert.equal(second.preview.included.length, 1);
  assert.equal(register.lookupCalls.length, 1, "the second export reads the directory");

  const row = await partnerOf(companyId, DELTA.ico);
  assert.equal(row.legalName, DELTA.name);
  assert.equal(row.street, "Trnavská 3");
  assert.equal(row.dic, DELTA.dic);
});

test("a manually corrected subject is exported with the corrected values", async () => {
  await freshTestDb();
  const companyId = await seedCompany("Acme", "partners-manual");
  const learner = new FakeCompanyRegister({ lookups: [registered(ALFA)] });
  await learn(ALFA, deps(learner));
  const subject = await findSubjectByIco("SK", ALFA.ico);
  assert.ok(subject);
  await correctSubjectField(subject.id, "legalName", "Alfa Oprava s.r.o.", NOW);
  await correctSubjectField(subject.id, "address", "Oprava 7, 821 01 Bratislava", NOW);
  await correctSubjectField(subject.id, "dic", "2020999999", NOW);
  await correctSubjectField(subject.id, "icDph", "SK2020999999", NOW);

  await seedAndConfirm(companyId, "doc-alfa", { ...ALFA, name: "Alfa, s.r.o.", dic: "" });

  const register = new FakeCompanyRegister({ lookups: [] });
  await exportMonth(companyId, deps(register));
  assert.deepEqual(register.lookupCalls, []);

  const row = await partnerOf(companyId, ALFA.ico);
  assert.equal(row.legalName, "Alfa Oprava s.r.o.");
  assert.equal(row.street, "Oprava 7");
  assert.equal(row.psc, "821 01");
  assert.equal(row.city, "Bratislava");
  assert.equal(row.dic, "2020999999");
  assert.equal(row.icDph, "SK2020999999");
});

test("with the registers down, known partners keep their details and an unknown one keeps the document's", async () => {
  await freshTestDb();
  const companyId = await seedCompany("Acme", "partners-down");
  const learner = new FakeCompanyRegister({ lookups: [registered(ALFA)] });
  // ALFA was last checked long ago, so the export must ask the register, which is down.
  await learn(ALFA, deps(learner, LONG_AGO));

  await seedAndConfirm(companyId, "doc-alfa", { ...ALFA, name: "Alfa, s.r.o.", dic: "" });
  await seedAndConfirm(companyId, "doc-gamma", GAMMA);

  const register = new FakeCompanyRegister({ lookups: [] });
  register.failure = new Error("RPO nedostupný");
  const { preview } = await exportMonth(companyId, deps(register));

  assert.equal(preview.included.length, 2);
  assert.deepEqual(register.lookupCalls.map((call) => call.ico).sort(), [ALFA.ico, GAMMA.ico].sort());

  const alfa = await partnerOf(companyId, ALFA.ico);
  assert.equal(alfa.legalName, ALFA.name);
  assert.equal(alfa.street, "Pribinova 25");
  assert.equal(alfa.city, "Bratislava");
  assert.equal(alfa.dic, ALFA.dic);

  const gamma = await partnerOf(companyId, GAMMA.ico);
  assert.equal(gamma.legalName, GAMMA.name);
  assert.equal(gamma.dic, GAMMA.dic);
  assert.equal(gamma.street, "");
});

test("a known partner with the registers down exports its full details without any call", async () => {
  await freshTestDb();
  const companyId = await seedCompany("Acme", "partners-down-fresh");
  await learn(BETA, deps(new FakeCompanyRegister({ lookups: [registered(BETA)] })));
  await seedAndConfirm(companyId, "doc-beta", { ...BETA, name: "Beta, s.r.o.", dic: "" });

  const register = new FakeCompanyRegister({ lookups: [] });
  register.failure = new Error("RPO nedostupný");
  await exportMonth(companyId, deps(register));

  assert.deepEqual(register.lookupCalls, []);
  const row = await partnerOf(companyId, BETA.ico);
  assert.equal(row.legalName, BETA.name);
  assert.equal(row.street, "Hlavná 12");
  assert.equal(row.psc, "040 01");
  assert.equal(row.dic, BETA.dic);
});

test("a stale subject is refreshed once for the month, and her manual fields are kept", async () => {
  await freshTestDb();
  const companyId = await seedCompany("Acme", "partners-stale");
  await learn(ALFA, deps(new FakeCompanyRegister({ lookups: [registered(ALFA)] }), LONG_AGO));
  const subject = await findSubjectByIco("SK", ALFA.ico);
  assert.ok(subject);
  await correctSubjectField(subject.id, "legalName", "Alfa Oprava s.r.o.", LONG_AGO);

  await seedAndConfirm(companyId, "doc-alfa-1", { ...ALFA, name: "Alfa, s.r.o.", dic: "" });
  await seedAndConfirm(companyId, "doc-alfa-2", { ...ALFA, name: "ALFA s.r.o.", dic: "" });

  const register = new FakeCompanyRegister({
    lookups: [registered(ALFA, { address: "Nová 5, 811 01 Bratislava" })],
  });
  const { preview } = await exportMonth(companyId, deps(register));

  assert.equal(preview.included.length, 2);
  assert.equal(register.lookupCalls.length, 1, "refreshed once, then read from the directory");

  const refreshed = await findSubjectByIco("SK", ALFA.ico);
  assert.equal(refreshed?.address, "Nová 5, 811 01 Bratislava");
  assert.equal(refreshed?.legalName, "Alfa Oprava s.r.o.", "her correction is kept over the refresh");
  assert.ok(refreshed?.manualFields.includes("legalName"));

  const row = await partnerOf(companyId, ALFA.ico);
  assert.equal(row.legalName, "Alfa Oprava s.r.o.");
  assert.equal(row.street, "Nová 5");
  assert.equal(row.psc, "811 01");
});

test("a lookup deferred by the rate limit falls back to the document's values", async () => {
  await freshTestDb();
  const companyId = await seedCompany("Acme", "partners-deferred");
  await seedAndConfirm(companyId, "doc-delta", { ...DELTA, name: "Delta, s.r.o.", dic: "" });

  const register = new FakeCompanyRegister({ lookups: [registered(DELTA)] });
  const { preview } = await exportMonth(companyId, deps(register, NOW, 0));

  assert.equal(preview.included.length, 1);
  assert.deepEqual(register.lookupCalls, []);
  const row = await partnerOf(companyId, DELTA.ico);
  assert.equal(row.legalName, "Delta, s.r.o.");
  assert.equal(row.street, "");
});

test("each client keeps its own partner list while the directory is shared", async () => {
  await freshTestDb();
  const first = await seedCompany("Acme", "partners-first");
  const second = await seedCompany("Beta klient", "partners-second");
  const register = new FakeCompanyRegister({ lookups: [registered(ALFA)] });
  await seedAndConfirm(first, "doc-acme", { ...ALFA, name: "Alfa, s.r.o.", dic: "" });
  await seedAndConfirm(second, "doc-klient", { ...ALFA, name: "ALFA s.r.o.", dic: "" });

  await exportMonth(first, deps(register));
  await exportMonth(second, deps(register));

  assert.equal(register.lookupCalls.length, 1, "one lookup serves both clients");
  assert.equal((await partnerOf(first, ALFA.ico)).legalName, ALFA.name);
  assert.equal((await partnerOf(second, ALFA.ico)).legalName, ALFA.name);
  const rows = await getDb().select().from(partners).where(eq(partners.ico, ALFA.ico));
  assert.equal(rows.length, 2);
});
