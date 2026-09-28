import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createStubExtractor } from "../../../src/adapters/extractor/stub-extractor.ts";
import { FakeOcr } from "../../../src/adapters/ocr/fake-ocr.ts";
import { stubTextLinesForDriveFile } from "../../../src/adapters/extractor/stub-fixtures.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { saveCompanyProfile } from "../../../src/adapters/store/company-profiles.ts";
import { runMigrations, resetDbForTests, getDb } from "../../../src/lib/db/migrate.ts";
import { companies, documents, events, files, months } from "../../../src/lib/db/schema.ts";
import { discoverModelExtractionForMonth } from "../../../src/lib/model-extraction/discover-model-extraction.ts";
import { buildMonthDocumentView } from "../../../src/lib/documents/view.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import type { PdfAccess } from "../../../src/adapters/pdf/port.ts";
import {
  isModelExtractedPayload,
  parseConfirmedPayload,
  parseExtractedPayload,
} from "../../../src/modules/document-payload.ts";
const PARENT_ID = "model-parent";
const COMPANY_ID = "model-company";
const MONTH_ID = "model-month";
const SLOT_02_ID = "model-slot-02";
const INVOICE_ID = "doc-invoice-a";

const fixtureTree = [
  {
    id: PARENT_ID,
    name: "Clients",
    parents: [] as string[],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: COMPANY_ID,
    name: "Delta s.r.o.",
    parents: [PARENT_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: MONTH_ID,
    name: "2026_01",
    parents: [COMPANY_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: SLOT_02_ID,
    name: "02 Prijaté faktúry",
    parents: [MONTH_ID],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  },
  {
    id: INVOICE_ID,
    name: "invoice-a.pdf",
    parents: [SLOT_02_ID],
    createdTime: "2026-01-12T00:00:00.000Z",
    mimeType: "application/pdf",
  },
];

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hugo-model-")),
    "test.db",
  );
}

function syntheticPdfAccess(lines: string[]): PdfAccess {
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
  };
}

test("stub extractor fills a text-layer invoice with checks and derived roles", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const lines = stubTextLinesForDriveFile(INVOICE_ID)!;
  const driveClient = new FakeDriveClient(fixtureTree, {
    [INVOICE_ID]: new Uint8Array(Buffer.from("pdf")),
  });

  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);

  saveCompanyProfile(1, {
    country: "SK",
    legalName: "Beta s.r.o.",
    address: "Bratislava",
    ico: "31333532",
    dic: "2020311335",
    icDph: "SK7120001713",
    registerSource: "fake",
    savedAt: "2026-01-12T10:00:00.000Z",
  });

  await discoverModelExtractionForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess(lines),
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const db = getDb();
  const row = db.select().from(documents).where(eq(documents.driveFileId, INVOICE_ID)).get()!;
  assert.equal(row.extractionStatus, "complete");

  const extracted = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isModelExtractedPayload(extracted), true);
  if (isModelExtractedPayload(extracted)) {
    assert.equal(extracted.source, "model");
    assert.ok(extracted.fieldChecks);
    assert.equal(extracted.fieldChecks?.documentNumber, "correct");
    assert.equal(extracted.fieldChecks?.amountCents, "correct");
  }

  const view = buildMonthDocumentView(1, "2026_01")!;
  const invoice = view.documents.find((document) => document.driveFileId === INVOICE_ID)!;
  assert.equal(invoice.fieldEditor.fields.supplierName, "Dodávateľ s.r.o.");
  assert.equal(invoice.fieldEditor.fields.customerName, "Beta s.r.o.");
  assert.equal(invoice.fieldEditor.rolesFlagged, false);

  const extractedEvents = db
    .select()
    .from(events)
    .where(eq(events.type, "Extracted"))
    .all();
  assert.equal(extractedEvents.length, 1);
  const eventPayload = JSON.parse(extractedEvents[0]!.payloadJson) as { source?: string };
  assert.equal(eventPayload.source, "model");
});

test("re-extraction rewrites extracted payload but keeps confirmed fields", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: COMPANY_ID, name: "Delta s.r.o.", active: true })
    .run();
  db.insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_01",
      driveFolderId: MONTH_ID,
      closedAt: null,
      openedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
  db.insert(files)
    .values({
      driveFileId: INVOICE_ID,
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "02 Prijaté faktúry",
      parentId: SLOT_02_ID,
      name: "invoice-a.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-12T00:00:00.000Z",
      firstSeenAt: "2026-01-12T10:00:00.000Z",
      lastSeenAt: "2026-01-12T10:00:00.000Z",
      deleted: false,
    })
    .run();
  db.insert(documents)
    .values({
      id: INVOICE_ID,
      driveFileId: INVOICE_ID,
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "02 Prijaté faktúry",
      extractionStatus: "pending",
      extractionFailureReason: null,
      extractedPayloadJson: "{}",
      confirmedPayloadJson: JSON.stringify({ supplierName: "Her hand-typed name" }),
      createdAt: "2026-01-12T09:00:00.000Z",
    })
    .run();

  const lines = stubTextLinesForDriveFile(INVOICE_ID)!;
  const driveClient = new FakeDriveClient(fixtureTree, {
    [INVOICE_ID]: new Uint8Array(Buffer.from("pdf")),
  });

  await discoverModelExtractionForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess(lines),
    ocr: new FakeOcr(),
    extractor: createStubExtractor(),
    now: () => "2026-01-12T11:00:00.000Z",
  });

  const row = db.select().from(documents).where(eq(documents.driveFileId, INVOICE_ID)).get()!;
  const confirmed = parseConfirmedPayload(row.confirmedPayloadJson);
  assert.equal(confirmed.supplierName, "Her hand-typed name");

  const view = buildMonthDocumentView(1, "2026_01")!;
  const invoice = view.documents.find((document) => document.driveFileId === INVOICE_ID)!;
  assert.equal(invoice.fieldEditor.fields.supplierName, "Her hand-typed name");
  assert.equal(invoice.fieldEditor.provenance.supplierName, "confirmed");
});

test("unreachable extractor leaves document pending", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const db = getDb();
  db.insert(companies)
    .values({ id: 1, driveFolderId: COMPANY_ID, name: "Delta s.r.o.", active: true })
    .run();
  db.insert(months)
    .values({
      id: 1,
      companyId: 1,
      monthKey: "2026_01",
      driveFolderId: MONTH_ID,
      closedAt: null,
      openedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
  db.insert(files)
    .values({
      driveFileId: INVOICE_ID,
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "02 Prijaté faktúry",
      parentId: SLOT_02_ID,
      name: "invoice-a.pdf",
      mimeType: "application/pdf",
      driveCreatedTime: "2026-01-12T00:00:00.000Z",
      firstSeenAt: "2026-01-12T10:00:00.000Z",
      lastSeenAt: "2026-01-12T10:00:00.000Z",
      deleted: false,
    })
    .run();
  db.insert(documents)
    .values({
      id: INVOICE_ID,
      driveFileId: INVOICE_ID,
      companyId: 1,
      monthKey: "2026_01",
      folderSlot: "02 Prijaté faktúry",
      extractionStatus: "pending",
      extractionFailureReason: null,
      extractedPayloadJson: "{}",
      confirmedPayloadJson: "{}",
      createdAt: "2026-01-12T09:00:00.000Z",
    })
    .run();

  const lines = stubTextLinesForDriveFile(INVOICE_ID)!;
  const driveClient = new FakeDriveClient(fixtureTree, {
    [INVOICE_ID]: new Uint8Array(Buffer.from("pdf")),
  });

  await discoverModelExtractionForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: syntheticPdfAccess(lines),
    ocr: new FakeOcr(),
    extractor: {
      async extract() {
        throw new Error("Extractor HTTP 503");
      },
    },
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const row = db.select().from(documents).where(eq(documents.driveFileId, INVOICE_ID)).get()!;
  assert.equal(row.extractionStatus, "pending");
});

// Until 2026-09-27 the model saw only page 1; an invoice whose VAT summary
// sits on a later page lost it.
test("the model reads every page of a multi-page invoice, up to the cap", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const pageOne = stubTextLinesForDriveFile(INVOICE_ID)!;
  const pageTwo = ["Rekapitulácia DPH | 23 % | 100,00 | 23,00"];
  const requestedPages: Array<number | undefined> = [];
  const twoPagePdf: PdfAccess = {
    async extractTextLines(_bytes, options) {
      requestedPages.push(options?.maxPages);
      return options?.maxPages && options.maxPages >= 2 ? [...pageOne, ...pageTwo] : pageOne;
    },
    async extractAttachments() {
      return [];
    },
    async extractPageImages() {
      return [];
    },
  };
  const seenLines: string[][] = [];
  const stub = createStubExtractor();
  const recordingExtractor = {
    async extract(input: Parameters<typeof stub.extract>[0]) {
      seenLines.push([...input.textLines]);
      return stub.extract(input);
    },
  };

  const driveClient = new FakeDriveClient(fixtureTree, {
    [INVOICE_ID]: new Uint8Array(Buffer.from("pdf")),
  });
  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);

  await discoverModelExtractionForMonth(1, "2026_01", {
    driveClient,
    pdfAccess: twoPagePdf,
    ocr: new FakeOcr(),
    extractor: recordingExtractor,
    now: () => "2026-01-12T10:00:00.000Z",
  });

  assert.ok(requestedPages.every((maxPages) => maxPages === 5), `asked for ${requestedPages}`);
  assert.equal(seenLines.length, 1);
  assert.ok(seenLines[0]!.includes(pageTwo[0]!));
});

// Her Omega invoices embed the invoice as ISDOC data; it is read exactly and
// the model is never asked.
test("an invoice that carries its ISDOC is read from it, without the model", async () => {
  const dbPath = tempDbPath();
  process.env.DATABASE_PATH = dbPath;
  resetDbForTests();
  runMigrations(dbPath);

  const driveClient = new FakeDriveClient(fixtureTree, {
    [INVOICE_ID]: new Uint8Array(Buffer.from("pdf")),
  });
  setDriveParentFolderId(PARENT_ID);
  await runSweep(driveClient);
  saveCompanyProfile(1, {
    country: "SK",
    legalName: "Beta s.r.o.",
    address: "Bratislava",
    ico: "31333532",
    dic: "2020311335",
    icDph: "SK7120001713",
    registerSource: "fake",
    savedAt: "2026-01-12T10:00:00.000Z",
  });

  const xml = `<?xml version="1.0"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>1</DocumentType><ID>FA-2026-0042</ID>
  <IssueDate>2026-01-10</IssueDate><TaxPointDate>2026-01-09</TaxPointDate>
  <LocalCurrencyCode>EUR</LocalCurrencyCode>
  <AccountingSupplierParty><Party><PartyIdentification><ID>87654321</ID></PartyIdentification>
    <PartyName><Name>Dodávateľ s.r.o.</Name></PartyName>
    <PartyTaxScheme><CompanyID>SK8765432100</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyIdentification><ID>31333532</ID></PartyIdentification>
    <PartyName><Name>Beta s.r.o.</Name></PartyName>
    <PartyTaxScheme><CompanyID>SK7120001713</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme></Party></AccountingCustomerParty>
  <TaxTotal><TaxSubTotal><TaxableAmount>26.83</TaxableAmount><TaxAmount>6.17</TaxAmount>
    <TaxCategory><Percent>23</Percent></TaxCategory></TaxSubTotal></TaxTotal>
  <LegalMonetaryTotal><TaxInclusiveAmount>33.00</TaxInclusiveAmount></LegalMonetaryTotal>
  <PaymentMeans><Payment><Details><PaymentDueDate>2026-01-24</PaymentDueDate><VariableSymbol>20260042</VariableSymbol></Details></Payment></PaymentMeans>
</Invoice>`;
  const pdfAccess: PdfAccess = {
    async extractTextLines() {
      return ["Faktúra FA-2026-0042"];
    },
    async extractAttachments() {
      return [{ filename: "invoice.isdoc", content: new TextEncoder().encode(xml) }];
    },
    async extractPageImages() {
      return [];
    },
  };
  const modelNeverAsked = {
    async extract(): Promise<never> {
      throw new Error("the model must not be asked for an ISDOC invoice");
    },
  };

  await discoverModelExtractionForMonth(1, "2026_01", {
    driveClient,
    pdfAccess,
    ocr: new FakeOcr(),
    extractor: modelNeverAsked,
    now: () => "2026-01-12T10:00:00.000Z",
  });

  const row = getDb().select().from(documents).where(eq(documents.driveFileId, INVOICE_ID)).get()!;
  assert.equal(row.extractionStatus, "complete");
  const extracted = parseExtractedPayload(row.extractedPayloadJson);
  assert.equal(isModelExtractedPayload(extracted) && extracted.source, "isdoc");

  const invoice = buildMonthDocumentView(1, "2026_01")!.documents.find(
    (document) => document.driveFileId === INVOICE_ID,
  )!;
  assert.equal(invoice.extractionSource, "isdoc");
  assert.equal(invoice.fieldEditor.fields.supplierName, "Dodávateľ s.r.o.");
  assert.equal(invoice.fieldEditor.fields.customerName, "Beta s.r.o.");
  assert.equal(invoice.fieldEditor.rolesFlagged, false);
});
