import { test } from "node:test";
import assert from "node:assert/strict";
import iconv from "iconv-lite";
import {
  buildOmegaFileBytes,
  planOmegaExport,
  type OmegaExportInput,
  type OmegaInvoiceDraft,
} from "../../../src/modules/omega-file.ts";

function decode1250(bytes: Buffer): string {
  return iconv.decode(bytes, "win1250");
}

function sampleInvoice(partial: Partial<OmegaInvoiceDraft> = {}): OmegaInvoiceDraft {
  return {
    driveFileId: "inv-1",
    exportNumber: "H2605-0001",
    docType: 0,
    variableSymbol: "2026075",
    issueDate: "19.05.2026",
    dueDate: "03.06.2026",
    taxableSupplyDate: "19.05.2026",
    currency: "EUR",
    counterparty: {
      partnerKey: "SK:57356661",
      country: "SK",
      name: "XLT Group s. r. o.",
      street: "Žltá 3959/9",
      psc: "851 07",
      city: "Bratislava",
      ico: "57356661",
      dic: "2122684520",
      icDph: "SK2023141351",
    },
    vatRecap: [
      {
        rateLiteral: "23",
        baseLiteral: "115",
        baseCents: 11500,
        vatLiteral: "26.45",
        vatCents: 2645,
      },
    ],
    totalCents: 14145,
    ...partial,
  };
}

const defaults = {
  t01EvidenceCode: "OF",
  t01SeriesCode: "OF",
  t01ReceivedEvidenceCode: "DF",
  t01ReceivedSeriesCode: "DF",
  t00EvidenceCode: "IDk",
  t00SeriesCode: "IDk",
  t00DocumentTypeCode: 180,
  t00ForeignDocumentTypeCode: 380,
};

test("planOmegaExport holds back overlong variable symbol", () => {
  const input: OmegaExportInput = {
    monthKey: "2026_05",
    settings: defaults,
    invoices: [
      sampleInvoice({
        variableSymbol: "123456789012345678901",
      }),
    ],
    receipts: [],
    partners: [],
  };
  const plan = planOmegaExport(input);
  assert.equal(plan.includedInvoices.length, 0);
  assert.equal(plan.heldBack.length, 1);
  assert.match(plan.heldBack[0]!.reason, /VS/i);
});

test("buildOmegaFileBytes uses T04 then T01, TAB and CRLF", () => {
  const invoice = sampleInvoice();
  const bytes = buildOmegaFileBytes({
    monthKey: "2026_05",
    settings: defaults,
    invoices: [invoice],
    receipts: [],
    partners: [invoice.counterparty],
  });
  const text = decode1250(bytes);
  assert.match(text, /^R00\tT04\r\n/);
  assert.match(text, /R00\tT01\r\n/);
  assert.ok(!text.replace(/\r\n/g, "").includes("\n"));
  assert.ok(!text.includes("\t\t602"));
});

test("issued invoice is type 0 and received is type 14", () => {
  const issued = buildOmegaFileBytes({
    monthKey: "2026_05",
    settings: defaults,
    invoices: [sampleInvoice({ docType: 0 })],
    receipts: [],
    partners: [sampleInvoice().counterparty],
  });
  const received = buildOmegaFileBytes({
    monthKey: "2026_05",
    settings: defaults,
    invoices: [sampleInvoice({ docType: 14, exportNumber: "H2605-0002" })],
    receipts: [],
    partners: [sampleInvoice().counterparty],
  });
  function t01Header(text: string): string {
    const section = text.split("R00\tT01\r\n")[1] ?? "";
    return section.split("\r\n").find((l) => l.startsWith("R01\t"))!;
  }
  const issuedHeader = t01Header(decode1250(issued));
  const receivedHeader = t01Header(decode1250(received));
  const issuedCols = issuedHeader.split("\t");
  const receivedCols = receivedHeader.split("\t");
  assert.equal(issuedCols[17], "0");
  assert.equal(receivedCols[17], "14");
});

test("VAT lands in higher-rate slots for 23%", () => {
  const bytes = buildOmegaFileBytes({
    monthKey: "2026_05",
    settings: defaults,
    invoices: [sampleInvoice()],
    receipts: [],
    partners: [sampleInvoice().counterparty],
  });
  const section = decode1250(bytes).split("R00\tT01\r\n")[1] ?? "";
  const header = section.split("\r\n").find((l) => l.startsWith("R01\t"))!;
  const cols = header.split("\t");
  assert.equal(cols[1], "H2605-0001");
  assert.equal(cols[8], "115");
  assert.equal(cols[14], "26.45");
  assert.equal(cols[16], "141.45");
  assert.equal(cols[70], "2026075");
});

test("partner name is shortened but ICO holds back when too long", () => {
  const longName = "A".repeat(90);
  const ok = buildOmegaFileBytes({
    monthKey: "2026_05",
    settings: defaults,
    invoices: [
      sampleInvoice({
        counterparty: {
          ...sampleInvoice().counterparty,
          name: longName,
        },
      }),
    ],
    receipts: [],
    partners: [
      {
        ...sampleInvoice().counterparty,
        name: longName,
      },
    ],
  });
  const partnerLine = decode1250(ok)
    .split("R00\tT04\r\n")[1]!
    .split("\r\n")[0]!;
  assert.equal(partnerLine!.split("\t")[1]?.length, 75);

  const plan = planOmegaExport({
    monthKey: "2026_05",
    settings: defaults,
    invoices: [
      sampleInvoice({
        counterparty: {
          ...sampleInvoice().counterparty,
          ico: "1234567890123",
        },
      }),
    ],
    receipts: [],
    partners: [],
  });
  assert.equal(plan.includedInvoices.length, 0);
});

test("buildOmegaFileBytes appends T00 after T01 for receipts", () => {
  const invoice = sampleInvoice();
  const receipt = {
    driveFileId: "rcpt-1",
    exportNumber: "H2605-0002",
    docTypeCode: 180,
    evidenceCode: "IDk",
    seriesCode: "IDk",
    externalNumber: "12345",
    issueDate: "19.05.2026",
    receiptDate: "19.05.2026",
    dueDate: "19.05.2026",
    taxableSupplyDate: "19.05.2026",
    transactionDate: "19.05.2026",
    currency: "EUR",
    foreignCurrency: false,
    counterparty: invoice.counterparty,
    vatRecap: invoice.vatRecap,
    totalCents: invoice.totalCents,
  };
  const bytes = buildOmegaFileBytes({
    monthKey: "2026_05",
    settings: defaults,
    invoices: [invoice],
    receipts: [receipt],
    partners: [invoice.counterparty],
  });
  const text = decode1250(bytes);
  const t01Pos = text.indexOf("R00\tT01");
  const t00Pos = text.indexOf("R00\tT00");
  assert.ok(t01Pos >= 0 && t00Pos > t01Pos);
  const t00Section = text.split("R00\tT00\r\n")[1] ?? "";
  const header = t00Section.split("\r\n").find((l) => l.startsWith("R01\t"))!;
  const cols = header.split("\t");
  assert.equal(cols[1], "180");
  assert.equal(cols[2], "IDk");
  assert.equal(cols[5], "12345");
  assert.equal(cols[53], "12345");
  const item = t00Section.split("\r\n").find((l) => l.startsWith("R02\t"))!;
  const itemCols = item.split("\t");
  assert.equal(itemCols[1], "0");
  assert.equal(itemCols[2], "");
  assert.equal(itemCols[4], "");
});

// Halierové vyrovnanie: spec field #16 of the T01 header and #29 of the T00
// header (file columns 15 and 28), both mandatory.
const T01_ROUNDING_COLUMN = 15;
const T00_ROUNDING_COLUMN = 28;

function cashReceipt(totalCents: number, currency = "EUR") {
  return {
    driveFileId: "rcpt-cash",
    exportNumber: "H2605-0003",
    docTypeCode: 180,
    evidenceCode: "IDk",
    seriesCode: "IDk",
    externalNumber: "1454",
    issueDate: "17.05.2026",
    receiptDate: "17.05.2026",
    dueDate: "17.05.2026",
    taxableSupplyDate: "17.05.2026",
    transactionDate: "17.05.2026",
    currency,
    foreignCurrency: false,
    counterparty: sampleInvoice().counterparty,
    // Fuel for 19.83: base 16.12, VAT 3.71.
    vatRecap: [
      { rateLiteral: "23", baseLiteral: "16.12", baseCents: 1612, vatLiteral: "3.71", vatCents: 371 },
    ],
    totalCents,
  };
}

function headerColumns(text: string, section: "T01" | "T00"): string[] {
  const body = text.split(`R00\t${section}\r\n`)[1]!.split("R00\t")[0]!;
  return body.split("\r\n").find((line) => line.startsWith("R01\t"))!.split("\t");
}

test("a cash receipt's rounding is written as halierové vyrovnanie in T00", () => {
  const text = decode1250(
    buildOmegaFileBytes({
      monthKey: "2026_05",
      settings: defaults,
      invoices: [],
      receipts: [cashReceipt(1985)],
      partners: [],
    }),
  );
  const cols = headerColumns(text, "T00");
  assert.equal(cols[T00_ROUNDING_COLUMN], "0.02");
  assert.equal(cols[19], "19.85");
});

test("an exact total writes a zero rounding in both sections", () => {
  const text = decode1250(
    buildOmegaFileBytes({
      monthKey: "2026_05",
      settings: defaults,
      invoices: [sampleInvoice()],
      receipts: [cashReceipt(1983)],
      partners: [],
    }),
  );
  assert.equal(headerColumns(text, "T01")[T01_ROUNDING_COLUMN], "0");
  assert.equal(headerColumns(text, "T00")[T00_ROUNDING_COLUMN], "0");
});

test("a Czech cash total rounded to the koruna is written as rounding", () => {
  const invoice = sampleInvoice({
    currency: "CZK",
    vatRecap: [
      { rateLiteral: "21", baseLiteral: "82.31", baseCents: 8231, vatLiteral: "17.29", vatCents: 1729 },
    ],
    totalCents: 10000,
  });
  const text = decode1250(
    buildOmegaFileBytes({
      monthKey: "2026_05",
      settings: defaults,
      invoices: [invoice],
      receipts: [],
      partners: [],
    }),
  );
  assert.equal(headerColumns(text, "T01")[T01_ROUNDING_COLUMN], "0.40");
});

test("a total that differs from base plus VAT by more than the rounding is held back", () => {
  const plan = planOmegaExport({
    monthKey: "2026_05",
    settings: defaults,
    invoices: [sampleInvoice({ totalCents: 14200 })],
    receipts: [cashReceipt(1990)],
    partners: [],
  });
  assert.equal(plan.includedInvoices.length, 0);
  assert.equal(plan.includedReceipts.length, 0);
  assert.equal(plan.heldBack.length, 2);
  for (const entry of plan.heldBack) {
    assert.match(entry.reason, /zaokrúhlenie/);
  }
});
