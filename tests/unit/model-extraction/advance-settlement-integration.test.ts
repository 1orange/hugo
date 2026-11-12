import { test } from "node:test";
import assert from "node:assert/strict";
import iconv from "iconv-lite";
import { eq } from "drizzle-orm";
import type { Extractor } from "../../../src/adapters/extractor/port.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { FakeCompanyRegister } from "../../../src/adapters/company-register/fake-company-register.ts";
import { getDb } from "../../../src/lib/db/client.ts";
import { companies, documents, files, months } from "../../../src/lib/db/schema.ts";
import { discoverModelExtractionForMonth } from "../../../src/lib/model-extraction/discover-model-extraction.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import { buildMonthOmegaExport } from "../../../src/lib/omega-export/service.ts";
import { confirmDocument } from "../../../src/lib/documents/service.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { EXTRACTION_PIPELINE_VERSION } from "../../../src/modules/extraction-pipeline.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import type { ModelExtractedPayload } from "../../../src/modules/document-payload.ts";
import { parseExtractedPayload } from "../../../src/modules/document-payload.ts";
import { freshTestDb } from "../support/test-db.ts";

const COMPANY_ID = "settle-company";
const MONTH_ID = "settle-month";
const SLOT_01_ID = "settle-slot-01";
const SLOT_02_ID = "settle-slot-02";
const NOW = "2026-05-20T10:00:00.000Z";

const fixtureTree = [
  { id: "settle-parent", name: "Clients", parents: [] as string[], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
  { id: COMPANY_ID, name: "Konto Acme", parents: ["settle-parent"], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
  { id: MONTH_ID, name: "2026_05", parents: [COMPANY_ID], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
  { id: SLOT_01_ID, name: "01 Vystavené faktúry", parents: [MONTH_ID], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
  { id: SLOT_02_ID, name: "02 Prijaté faktúry", parents: [MONTH_ID], createdTime: "2026-01-01T00:00:00.000Z", mimeType: FOLDER_MIME },
  { id: "settle-doc", name: "settled.pdf", parents: [SLOT_02_ID], createdTime: "2026-05-11T00:00:00.000Z", mimeType: "application/pdf" },
  { id: "settle-issued", name: "issued.pdf", parents: [SLOT_01_ID], createdTime: "2026-05-11T00:00:00.000Z", mimeType: "application/pdf" },
];

/** The synthetic layout of the full recap: `Celkom uhradených záloh` and `k úhrade 0,00`. */
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

/** What the model answers for it: the amount it reads is the amount due. */
const MODEL_ANSWER: ModelExtractedPayload = {
  kind: "extracted",
  source: "model",
  parties: [{ name: "Dodávateľ s.r.o.", ico: null, dic: null, icDph: "SK2020449189" }],
  documentNumber: "5022606206",
  variableSymbol: null,
  issueDate: null,
  taxableSupplyDate: "2026-05-11",
  dueDate: null,
  currency: "EUR",
  amountCents: 0,
  amountLiteral: "0.00",
  vatRecap: [{ rateLiteral: "23", baseLiteral: "364.65", baseCents: 36465, vatLiteral: "83.87", vatCents: 8387 }],
  docTypeHint: "invoice",
};

function textPdfAccess(lines: string[]): PdfAccess {
  return {
    async extractTextLines() {
      return lines;
    },
    async extractAttachments() {
      return [];
    },
    async extractPageImages() {
      return [];
    },
    async renderPages() {
      return [];
    },
  };
}

function countingExtractor(answer: ModelExtractedPayload | Error): { calls: () => number; extractor: Extractor } {
  let calls = 0;
  return {
    calls: () => calls,
    extractor: {
      async extract() {
        calls += 1;
        if (answer instanceof Error) {
          throw answer;
        }
        return { durationMs: 0, payload: answer };
      },
    },
  };
}

async function seedMonth(options: { closedAt?: string | null } = {}) {
  const db = getDb();
  await db.insert(companies).values({ id: 1, driveFolderId: COMPANY_ID, name: "Konto Acme", active: true });
  await db.insert(months).values({
    id: 1,
    companyId: 1,
    monthKey: "2026_05",
    driveFolderId: MONTH_ID,
    closedAt: options.closedAt ?? null,
    openedAt: "2026-05-01T00:00:00.000Z",
  });
}

async function seedFile(driveFileId: string, folderSlot: string, parentId: string) {
  await getDb().insert(files).values({
    driveFileId,
    companyId: 1,
    monthKey: "2026_05",
    folderSlot,
    parentId,
    name: `${driveFileId}.pdf`,
    mimeType: "application/pdf",
    driveCreatedTime: "2026-05-11T00:00:00.000Z",
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    deleted: false,
  });
}

/** A document already read by an earlier pipeline: a zero amount and no supply. */
const OLD_PAYLOAD = {
  kind: "extracted",
  source: "model",
  parties: [{ name: "Dodávateľ s.r.o.", ico: null, dic: null, icDph: "SK2020449189" }],
  documentNumber: "5022606206",
  variableSymbol: null,
  issueDate: null,
  taxableSupplyDate: "2026-05-11",
  dueDate: null,
  currency: "EUR",
  amountCents: 0,
  amountLiteral: "0.00",
  vatRecap: [],
  docTypeHint: "invoice",
};

async function seedDocument(
  driveFileId: string,
  overrides: Partial<typeof documents.$inferInsert> = {},
) {
  await getDb().insert(documents).values({
    id: driveFileId,
    driveFileId,
    companyId: 1,
    monthKey: "2026_05",
    folderSlot: "02 Prijaté faktúry",
    extractionStatus: "complete",
    extractionFailureReason: null,
    extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION - 1,
    extractedPayloadJson: JSON.stringify(OLD_PAYLOAD),
    confirmedPayloadJson: "{}",
    createdAt: "2026-05-11T09:00:00.000Z",
    ...overrides,
  });
}

async function readDocumentRow(driveFileId: string) {
  return (await getDb().select().from(documents).where(eq(documents.driveFileId, driveFileId)).limit(1))[0]!;
}

async function runDiscovery(extractor: Extractor, lines: string[] = SETTLED_LINES) {
  await discoverModelExtractionForMonth(1, "2026_05", {
    driveClient: new FakeDriveClient(fixtureTree, {
      "settle-doc": new Uint8Array(Buffer.from("pdf")),
      "settle-issued": new Uint8Array(Buffer.from("pdf")),
    }),
    pdfAccess: textPdfAccess(lines),
    ocr: new FakeOcr(),
    extractor,
    now: () => NOW,
  });
}

test("a settled invoice read by the pipeline stores its supply, with the settlement kept for audit", async () => {
  await freshTestDb();
  await seedMonth();
  await seedFile("settle-doc", "02 Prijaté faktúry", SLOT_02_ID);
  await seedDocument("settle-doc", { extractionPipelineVersion: null, extractedPayloadJson: "{}", extractionStatus: "pending" });

  const model = countingExtractor(MODEL_ANSWER);
  await runDiscovery(model.extractor);
  assert.equal(model.calls(), 1);

  const row = await readDocumentRow("settle-doc");
  assert.equal(row.extractionStatus, "complete");
  assert.equal(row.extractionPipelineVersion, EXTRACTION_PIPELINE_VERSION);
  const payload = parseExtractedPayload(row.extractedPayloadJson) as ModelExtractedPayload;
  assert.equal(payload.amountCents, 44852);
  assert.equal(payload.amountLiteral, "448.52");
  assert.deepEqual(payload.vatRecap.map((r) => [r.rateLiteral, r.baseCents, r.vatCents]), [["23", 36465, 8387]]);
  assert.deepEqual(payload.advanceSettlement, {
    source: "detected",
    totalProvenance: "extracted",
    advanceDeductedCents: 44852,
    advanceDeductedLiteral: "448.52",
    amountDueCents: 0,
    amountDueLiteral: "0.00",
    advanceDocumentNumbers: ["5926010455"],
    settlementRows: [],
    originalAmountCents: 0,
    originalAmountLiteral: "0.00",
    originalVatRecap: [{ rateLiteral: "23", baseLiteral: "364.65", baseCents: 36465, vatLiteral: "83.87", vatCents: 8387 }],
    identityWarning: null,
    findings: [],
  });
});

test("the document view shows the real values of a settled invoice, derived VAT from the supply only", async () => {
  await freshTestDb();
  await seedMonth();
  await seedFile("settle-doc", "02 Prijaté faktúry", SLOT_02_ID);
  await seedDocument("settle-doc", { extractionPipelineVersion: null, extractedPayloadJson: "{}", extractionStatus: "pending" });
  await runDiscovery(countingExtractor(MODEL_ANSWER).extractor);

  const view = (await buildMonthDocumentView(1, "2026_05"))!;
  const invoice = view.documents.find((document) => document.driveFileId === "settle-doc")!;
  assert.equal(invoice.fieldEditor.fields.amountLiteral, "448.52");
  assert.equal(invoice.fieldEditor.provenance.amountLiteral, "extracted");
  assert.equal(invoice.fieldEditor.fields.recapBaseLiteral, "364.65");
  assert.equal(invoice.fieldEditor.fields.recapVatLiteral, "83.87");
  assert.equal(invoice.fieldEditor.provenance.recapVatLiteral, "derived");
  assert.deepEqual(invoice.fieldEditor.fields.vatRecap.map((r) => r.rateLiteral), ["23"]);
  assert.equal(invoice.fieldEditor.advanceSettled, true);
});

test("a derived settled total is shown with derived provenance", async () => {
  await freshTestDb();
  await seedMonth();
  await seedFile("settle-doc", "02 Prijaté faktúry", SLOT_02_ID);
  await seedDocument("settle-doc", { extractionPipelineVersion: null, extractedPayloadJson: "{}", extractionStatus: "pending" });
  // The model read a total that is no printed total of the supply: the sum is taken instead.
  await runDiscovery(countingExtractor({ ...MODEL_ANSWER, amountCents: 13000, amountLiteral: "130.00" }).extractor);

  const view = (await buildMonthDocumentView(1, "2026_05"))!;
  const invoice = view.documents.find((document) => document.driveFileId === "settle-doc")!;
  assert.equal(invoice.fieldEditor.fields.amountLiteral, "448.52");
  assert.equal(invoice.fieldEditor.provenance.amountLiteral, "extracted");
});

test("an undecided result from an older pipeline is read again, keeping her confirmed fields", async () => {
  await freshTestDb();
  await seedMonth();
  await seedFile("settle-doc", "02 Prijaté faktúry", SLOT_02_ID);
  await seedDocument("settle-doc", { confirmedPayloadJson: JSON.stringify({ supplierName: "Ručne zadaný" }) });

  const model = countingExtractor(MODEL_ANSWER);
  await runDiscovery(model.extractor);
  assert.equal(model.calls(), 1);

  const row = await readDocumentRow("settle-doc");
  assert.equal(row.extractionStatus, "complete");
  assert.equal(row.extractionPipelineVersion, EXTRACTION_PIPELINE_VERSION);
  assert.equal(
    (parseExtractedPayload(row.extractedPayloadJson) as ModelExtractedPayload).amountCents,
    44852,
  );
  assert.equal(JSON.parse(row.confirmedPayloadJson).supplierName, "Ručne zadaný");
});

test("decided, exported and current documents are left alone by the pipeline upgrade", async () => {
  await freshTestDb();
  await seedMonth();
  await seedFile("settle-doc", "02 Prijaté faktúry", SLOT_02_ID);
  await seedDocument("settle-doc", { decision: "confirmed", decidedAt: NOW });
  await seedFile("settle-issued", "01 Vystavené faktúry", SLOT_01_ID);
  await seedDocument("settle-issued", {
    folderSlot: "01 Vystavené faktúry",
    exportedAt: NOW,
    exportBatch: "batch-1",
    extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION - 1,
  });

  const model = countingExtractor(MODEL_ANSWER);
  await runDiscovery(model.extractor);
  assert.equal(model.calls(), 0);
  assert.equal((await readDocumentRow("settle-doc")).extractedPayloadJson, JSON.stringify(OLD_PAYLOAD));
  assert.equal((await readDocumentRow("settle-issued")).extractionPipelineVersion, EXTRACTION_PIPELINE_VERSION - 1);
});

test("a result under the current pipeline and a closed month are not read again", async () => {
  await freshTestDb();
  await seedMonth({ closedAt: "2026-06-02T10:00:00.000Z" });
  await seedFile("settle-doc", "02 Prijaté faktúry", SLOT_02_ID);
  await seedDocument("settle-doc");

  const closed = countingExtractor(MODEL_ANSWER);
  await runDiscovery(closed.extractor);
  assert.equal(closed.calls(), 0);

  const db = getDb();
  await db.update(months).set({ closedAt: null }).where(eq(months.id, 1));
  await db.update(documents).set({ extractionPipelineVersion: EXTRACTION_PIPELINE_VERSION }).where(eq(documents.driveFileId, "settle-doc"));
  const current = countingExtractor(MODEL_ANSWER);
  await runDiscovery(current.extractor);
  assert.equal(current.calls(), 0);
});

test("a re-read that fails keeps the earlier complete result and marks it current", async () => {
  await freshTestDb();
  await seedMonth();
  await seedFile("settle-doc", "02 Prijaté faktúry", SLOT_02_ID);
  await seedDocument("settle-doc");

  await runDiscovery(countingExtractor(new Error("Extractor HTTP 400: prompt refused")).extractor);

  const row = await readDocumentRow("settle-doc");
  assert.equal(row.extractionStatus, "complete");
  assert.equal(row.extractionFailureReason, null);
  assert.equal(row.extractedPayloadJson, JSON.stringify(OLD_PAYLOAD));
  assert.equal(row.extractionPipelineVersion, EXTRACTION_PIPELINE_VERSION);
});

test("a re-read while the extractor is unreachable changes nothing and is tried again later", async () => {
  await freshTestDb();
  await seedMonth();
  await seedFile("settle-doc", "02 Prijaté faktúry", SLOT_02_ID);
  await seedDocument("settle-doc");

  await runDiscovery(countingExtractor(new Error("fetch failed")).extractor);

  const row = await readDocumentRow("settle-doc");
  assert.equal(row.extractionStatus, "complete");
  assert.equal(row.extractedPayloadJson, JSON.stringify(OLD_PAYLOAD));
  assert.equal(row.extractionPipelineVersion, EXTRACTION_PIPELINE_VERSION - 1);

  const model = countingExtractor(MODEL_ANSWER);
  await runDiscovery(model.extractor);
  assert.equal(model.calls(), 1);
  assert.equal((await readDocumentRow("settle-doc")).extractionPipelineVersion, EXTRACTION_PIPELINE_VERSION);
});

test("the Omega export of a confirmed settled invoice carries the supply values", async () => {
  await freshTestDb();
  await seedMonth();
  await seedFile("settle-issued", "01 Vystavené faktúry", SLOT_01_ID);
  await seedDocument("settle-issued", {
    folderSlot: "01 Vystavené faktúry",
    extractionStatus: "pending",
    extractionPipelineVersion: null,
    extractedPayloadJson: "{}",
  });
  await runDiscovery(
    countingExtractor({
      ...MODEL_ANSWER,
      issueDate: "2026-05-11",
      parties: [
        { name: "Acme s.r.o.", ico: "31333532", dic: "2020311335", icDph: "SK2020311335" },
        { name: "Odberateľ s.r.o.", ico: "87654321", dic: "2023141351", icDph: "SK2023141351" },
      ],
    }).extractor,
    [...SETTLED_LINES, "Odberateľ: Odberateľ s.r.o. | IČO: 87654321, DIČ: 2023141351"],
  );
  await confirmDocument({ companyId: 1, monthKey: "2026_05", documentId: "settle-issued", confirmed: true });

  const result = await buildMonthOmegaExport({
    companyId: 1,
    monthKey: "2026_05",
    register: new FakeCompanyRegister(),
    now: "2026-05-21T12:00:00.000Z",
    persist: false,
  });
  assert.equal(result.preview.heldBack.length, 0, JSON.stringify(result.preview.heldBack));
  const text = iconv.decode(result.bytes, "win1250");
  // Omega's amounts are dotted: the total, the supply base and its VAT at 23 %.
  assert.match(text, /\tT01\r\nR01\t.*\t364\.65\t0\t0\t19\t23\t0\t83\.87\t0\t448\.52\t/);
});
