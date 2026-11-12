import { test } from "node:test";
import assert from "node:assert/strict";
import iconv from "iconv-lite";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, events, files, months } from "../../../src/lib/db/schema.ts";
import {
  ensureDocumentsForMonth,
  getDocument,
  writeExtractedPayload,
} from "../../../src/adapters/store/documents.ts";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { confirmDocument, setAdvanceSettlement } from "../../../src/lib/documents/service.ts";
import { buildMonthDocumentView, type DocumentListItem } from "../../../src/lib/documents/view.ts";
import { buildMonthOmegaExport } from "../../../src/lib/omega-export/service.ts";
import { processModelExtractionFromLines } from "../../../src/lib/model-extraction/process-model-extraction.ts";
import { applyAdvanceSettlement } from "../../../src/modules/advance-settlement.ts";
import { parseConfirmedPayload, type ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
import { freshTestDb } from "../support/test-db.ts";

const COMPANY_DRIVE_ID = "override-company";
const MONTH_ID = "override-month";
const SLOT_01_ID = "override-slot-01";
const SLOT_02_ID = "override-slot-02";
const INVOICE = "override-invoice";
const OVERRIDE_TIME = "2026-05-20T12:00:00.000Z";

const SETTLED_LINES = [
  "Rekapitulácia DPH daňového dokladu 5022606206",
  "Sadzba | Základ DPH | Čiastka DPH | Celkom s DPH",
  "23% | 364,65 | 83,87 | 448,52",
  "Celkom | 364,65 | 83,87 | 448,52",
  "Celková hodnota plnenia: | 448,52 EUR",
  "Celkom uhradených záloh: | 448,52 EUR",
  "Zálohové doklady č. : 5926010455 | 448,52 | EUR",
  "Celkom k úhrade vrátane DPH | 0,00 | EUR",
];

/** What the model answers for the settled invoice: the amount it reads is the amount due. */
const MODEL_ANSWER: ModelExtractedPayload = {
  kind: "extracted",
  source: "model",
  parties: [
    { name: "Acme s.r.o.", ico: "31333532", dic: "2020311335", icDph: "SK2020311335" },
    { name: "Odberateľ s.r.o.", ico: "87654321", dic: "2023141351", icDph: "SK2023141351" },
  ],
  documentNumber: "5022606206",
  variableSymbol: null,
  issueDate: "2026-05-11",
  taxableSupplyDate: "2026-05-11",
  dueDate: null,
  currency: "EUR",
  amountCents: 0,
  amountLiteral: "0.00",
  vatRecap: [{ rateLiteral: "23", baseLiteral: "364.65", baseCents: 36465, vatLiteral: "83.87", vatCents: 8387 }],
  docTypeHint: "invoice",
};

async function seedMonth(options: { closedAt?: string | null; folderSlot?: string } = {}) {
  await freshTestDb();
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: COMPANY_DRIVE_ID, name: "Acme s.r.o.", active: true });
  await db.insert(months).values({
    id: 1,
    companyId: 1,
    monthKey: "2026_05",
    driveFolderId: MONTH_ID,
    closedAt: options.closedAt ?? null,
    openedAt: "2026-05-01T00:00:00.000Z",
  });
  const folderSlot = options.folderSlot ?? "02 Prijaté faktúry";
  await db.insert(files).values({
    driveFileId: INVOICE,
    companyId: 1,
    monthKey: "2026_05",
    folderSlot,
    parentId: folderSlot.startsWith("01") ? SLOT_01_ID : SLOT_02_ID,
    name: "invoice.pdf",
    mimeType: "application/pdf",
    driveCreatedTime: "2026-05-11T00:00:00.000Z",
    firstSeenAt: "2026-05-11T00:00:00.000Z",
    lastSeenAt: "2026-05-11T00:00:00.000Z",
    deleted: false,
  });
  await ensureDocumentsForMonth(1, "2026_05", "2026-05-12T10:00:00.000Z");
}

/** An invoice the pipeline read: its settlement detected from the lines, or not. */
async function seedRead(answer: ModelExtractedPayload, lines: string[] | null) {
  const payload = lines ? applyAdvanceSettlement(answer, lines) : answer;
  await writeExtractedPayload(INVOICE, payload, "complete", null);
  await getDb()
    .update(documents)
    .set({ extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION })
    .where(eq(documents.id, INVOICE));
}

async function invoiceView(): Promise<DocumentListItem> {
  const view = await buildMonthDocumentView(1, "2026_05");
  const item = view!.documents.find((document) => document.id === INVOICE);
  assert.ok(item, "invoice is listed");
  return item;
}

async function overrideEvents() {
  return getDb().select().from(events).where(eq(events.type, "AdvanceSettlementOverridden"));
}

function set(settled: boolean, now = OVERRIDE_TIME) {
  return setAdvanceSettlement({ companyId: 1, monthKey: "2026_05", documentId: INVOICE, settled, now });
}

test("marking a detected settlement not settled restores the plain extraction, persists, and logs it", async () => {
  await seedMonth();
  await seedRead(MODEL_ANSWER, SETTLED_LINES);
  const before = await invoiceView();
  assert.equal(before.fieldEditor.advanceSettled, true);
  assert.equal(before.fieldEditor.fields.amountLiteral, "448.52");
  assert.equal(before.fieldEditor.advanceSettlementOverride, null);

  assert.deepStrictEqual(await set(false), { ok: true });

  // A fresh read, as after a reload.
  const after = await invoiceView();
  assert.equal(after.fieldEditor.advanceSettled, false);
  assert.equal(after.fieldEditor.advanceSettlement, null);
  assert.equal(after.fieldEditor.advanceSettlementOverride, false);
  assert.equal(after.fieldEditor.fields.amountLiteral, "0.00");
  assert.equal(after.fieldEditor.fields.recapVatLiteral, "83.87");
  assert.deepStrictEqual(parseConfirmedPayload((await getDocument(INVOICE))!.confirmedPayloadJson).advanceSettlement, {
    settled: false,
    source: "manual",
  });

  const logged = await overrideEvents();
  assert.equal(logged.length, 1);
  assert.deepStrictEqual(JSON.parse(logged[0]!.payloadJson), {
    monthKey: "2026_05",
    driveFileId: INVOICE,
    documentId: INVOICE,
    settled: false,
  });
  assert.equal(logged[0]!.actor, "user");
  assert.equal(logged[0]!.companyId, 1);
});

test("marking an undetected invoice settled applies the settlement from its payload", async () => {
  await seedMonth();
  // The pipeline read a zero amount beside the full supply, and no deduction label.
  await seedRead(MODEL_ANSWER, null);
  const before = await invoiceView();
  assert.equal(before.fieldEditor.advanceSettled, false);

  assert.deepStrictEqual(await set(true), { ok: true });

  const after = await invoiceView();
  assert.equal(after.fieldEditor.advanceSettled, true);
  assert.equal(after.fieldEditor.fields.amountLiteral, "448.52");
  assert.equal(after.fieldEditor.provenance.amountLiteral, "derived");
  assert.equal(after.fieldEditor.advanceSettlement?.source, "manual");
  assert.equal(after.fieldEditor.advanceSettlement?.amountDueCents, 0);
  assert.equal(after.fieldEditor.advanceSettlementOverride, true);
  assert.equal(after.fieldEditor.fields.recapVatLiteral, "83.87");
  assert.equal(await overrideEvents().then((rows) => rows.length), 1);
});

test("a settlement she marked survives a pipeline re-read, which keeps her confirmed values", async () => {
  await seedMonth();
  await seedRead(MODEL_ANSWER, null);
  assert.deepStrictEqual(await set(true), { ok: true });
  const confirmedBefore = (await getDocument(INVOICE))!.confirmedPayloadJson;

  // The model now reads the document with its deduction printed: the flag still decides.
  const reread = await processModelExtractionFromLines(
    {
      companyId: 1,
      monthKey: "2026_05",
      driveFileId: INVOICE,
      folderSlot: "02 Prijaté faktúry",
      lines: SETTLED_LINES,
    },
    { extractor: { async extract() { return { durationMs: 0, payload: MODEL_ANSWER }; } } },
  );
  assert.equal(reread, true);

  const row = (await getDocument(INVOICE))!;
  assert.equal(row.confirmedPayloadJson, confirmedBefore);
  const view = await invoiceView();
  assert.equal(view.fieldEditor.advanceSettled, true);
  assert.equal(view.fieldEditor.fields.amountLiteral, "448.52");
});

test("a not-settled flag survives a re-read that detects the settlement again", async () => {
  await seedMonth();
  await seedRead(MODEL_ANSWER, SETTLED_LINES);
  assert.deepStrictEqual(await set(false), { ok: true });

  await processModelExtractionFromLines(
    { companyId: 1, monthKey: "2026_05", driveFileId: INVOICE, folderSlot: "02 Prijaté faktúry", lines: SETTLED_LINES },
    { extractor: { async extract() { return { durationMs: 0, payload: MODEL_ANSWER }; } } },
  );

  const view = await invoiceView();
  assert.equal(view.fieldEditor.advanceSettled, false);
  assert.equal(view.fieldEditor.fields.amountLiteral, "0.00");
});

test("a decided document can still have its settlement changed, as its fields can be edited", async () => {
  await seedMonth();
  await seedRead(MODEL_ANSWER, SETTLED_LINES);
  assert.deepStrictEqual(
    await confirmDocument({ companyId: 1, monthKey: "2026_05", documentId: INVOICE, confirmed: true, now: OVERRIDE_TIME }),
    { ok: true },
  );
  const before = (await getDocument(INVOICE))!.confirmedPayloadJson;

  assert.deepStrictEqual(await set(false), { ok: true });
  const after = await getDocument(INVOICE);
  assert.notEqual(after!.confirmedPayloadJson, before);
  assert.equal(after!.decision, "confirmed", "the decision stands");
  assert.equal(await overrideEvents().then((rows) => rows.length), 1);
});

test("an exported document refuses the change", async () => {
  await seedMonth();
  await seedRead(MODEL_ANSWER, SETTLED_LINES);
  await getDb().update(documents).set({ exportedAt: "2026-05-21T00:00:00.000Z" }).where(eq(documents.id, INVOICE));

  assert.equal((await set(false)).ok, false);
  assert.equal(await overrideEvents().then((rows) => rows.length), 0);
});

test("a closed month refuses the change", async () => {
  await seedMonth({ closedAt: "2026-05-31T00:00:00.000Z" });
  await seedRead(MODEL_ANSWER, SETTLED_LINES);

  assert.equal((await set(false)).ok, false);
  assert.equal(await overrideEvents().then((rows) => rows.length), 0);
});

test("an undetected invoice with no deduction to read refuses being marked settled", async () => {
  await seedMonth();
  await seedRead({ ...MODEL_ANSWER, amountCents: 44852, amountLiteral: "448.52" }, null);

  assert.equal((await set(true)).ok, false);
  assert.equal(await overrideEvents().then((rows) => rows.length), 0);
});

function exportWith() {
  return buildMonthOmegaExport({
    companyId: 1,
    monthKey: "2026_05",
    register: new FakeCompanyRegister(),
    now: "2026-05-21T12:00:00.000Z",
    persist: false,
  });
}

test("the Omega export of a plain invoice is held back: total 0.00 beside a supply of 448.52", async () => {
  await seedMonth({ folderSlot: "01 Vystavené faktúry" });
  await seedRead(MODEL_ANSWER, null);
  assert.deepStrictEqual(
    await confirmDocument({ companyId: 1, monthKey: "2026_05", documentId: INVOICE, confirmed: true, now: OVERRIDE_TIME }),
    { ok: true },
  );

  const result = await exportWith();
  assert.equal(result.preview.heldBack.length, 1);
});

test("the Omega export of a settled invoice carries the supply, as she marked it", async () => {
  await seedMonth({ folderSlot: "01 Vystavené faktúry" });
  await seedRead(MODEL_ANSWER, null);
  assert.deepStrictEqual(await set(true), { ok: true });
  assert.deepStrictEqual(
    await confirmDocument({ companyId: 1, monthKey: "2026_05", documentId: INVOICE, confirmed: true, now: OVERRIDE_TIME }),
    { ok: true },
  );

  const result = await exportWith();
  assert.equal(result.preview.heldBack.length, 0, JSON.stringify(result.preview.heldBack));
  const text = iconv.decode(result.bytes, "win1250");
  assert.match(text, /\tT01\r\nR01\t.*\t364\.65\t0\t0\t19\t23\t0\t83\.87\t0\t448\.52\t/);
});

test("the document shows the identity warning for an advance that breaks total − advance = due", async () => {
  await seedMonth();
  const misread = [
    ...SETTLED_LINES.slice(0, 5),
    "Celkom uhradených záloh: | 448,25 EUR",
    "Celkom k úhrade vrátane DPH | 0,00 | EUR",
  ];
  await seedRead(MODEL_ANSWER, misread);

  const view = await invoiceView();
  assert.equal(view.fieldEditor.advanceSettled, true);
  assert.match(view.fieldEditor.advanceSettlement?.identityWarning ?? "", /^Odpočet zálohy nesedí/);
});

test("a consistent advance shows no identity warning", async () => {
  await seedMonth();
  await seedRead(MODEL_ANSWER, SETTLED_LINES);

  const view = await invoiceView();
  assert.equal(view.fieldEditor.advanceSettlement?.identityWarning, null);
});
