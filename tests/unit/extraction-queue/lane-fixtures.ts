import { stubTextLinesForDriveFile } from "../../../src/adapters/extractor/stub-fixtures.ts";
import { FakeDriveClient } from "../../../src/adapters/drive/fake-drive-client.ts";
import type { PdfAccess, PdfAttachment, PdfPageImage } from "../../../src/adapters/pdf/port.ts";
import { setDriveParentFolderId } from "../../../src/adapters/store/settings.ts";
import { FOLDER_MIME } from "../../../src/modules/drive-tree.ts";
import { runSweep } from "../../../src/lib/sweep/run-sweep.ts";
import { syntheticEkasaLines } from "../cash-discovery/synthetic-ekasa-lines.ts";
import { freshTestDb } from "../support/test-db.ts";

/**
 * Four files of one month, read by the two lanes in the tests: a document the
 * model reads, an ISDOC invoice, a scanned document (OCR, then the model), and
 * an eKasa receipt. Their bytes spell their Drive ids, so the fake PDF reader
 * can tell them apart.
 */
export const SLOT_02 = "02 Prijaté faktúry";
export const SLOT_04 = "04 Bločky_hotovosť";
export const LANE_NOW = "2026-01-12T10:00:00.000Z";

export const ISDOC_XML = `<?xml version="1.0"?>
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

/**
 * What each test file holds, by the id its bytes spell: the PDF's text, its
 * embedded invoice, its page images. The PDF bytes are the id, so the fake
 * reader can tell the files apart.
 */
export type Doc = { lines?: string[]; attachments?: PdfAttachment[]; images?: PdfPageImage[] };

export const SCANNED_PAGE: PdfPageImage = { kind: "rgba", data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 };
export const DOCS: Record<string, Doc> = {
  "doc-invoice-a": { lines: stubTextLinesForDriveFile("doc-invoice-a")! },
  "doc-isdoc": {
    lines: ["Faktúra FA-2026-0042"],
    attachments: [{ filename: "invoice.isdoc", content: new TextEncoder().encode(ISDOC_XML) }],
  },
  "doc-scan": { lines: [], images: [SCANNED_PAGE] },
  "doc-receipt": { lines: syntheticEkasaLines() },
};

export const OCR_BOXES = [
  { text: "FAKTÚRA č. 2026042", x: 0, y: 100 },
  { text: "Celkom 100.00 EUR", x: 0, y: 80 },
];

export function pdfFor(docs: Record<string, Doc>): PdfAccess {
  const of = (bytes: Uint8Array): Doc => docs[new TextDecoder().decode(bytes)] ?? {};
  return {
    async extractTextLines(bytes) {
      return of(bytes).lines ?? [];
    },
    async extractAttachments(bytes) {
      return of(bytes).attachments ?? [];
    },
    async extractPageImages(bytes) {
      return of(bytes).images ?? [];
    },
    async renderPages() {
      return [];
    },
  };
}

export function tree() {
  const folder = (id: string, name: string, parent: string | null) => ({
    id,
    name,
    parents: parent ? [parent] : [],
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: FOLDER_MIME,
  });
  const file = (id: string, slot: string) => ({
    id,
    name: `${id}.pdf`,
    parents: [slot],
    createdTime: "2026-01-05T00:00:00.000Z",
    mimeType: "application/pdf",
  });
  return [
    folder("parent", "Clients", null),
    folder("company", "Delta s.r.o.", "parent"),
    folder("month", "2026_01", "company"),
    folder("slot-02", SLOT_02, "month"),
    folder("slot-04", SLOT_04, "month"),
    file("doc-invoice-a", "slot-02"),
    file("doc-isdoc", "slot-02"),
    file("doc-scan", "slot-02"),
    file("doc-receipt", "slot-04"),
  ];
}

/** A swept month of the four fixture files, each with bytes that spell its id. */
export async function sweptMonth() {
  await freshTestDb();
  const contents = Object.fromEntries(
    Object.keys(DOCS).map((id) => [id, new TextEncoder().encode(id)]),
  );
  const driveClient = new FakeDriveClient(tree(), contents);
  await setDriveParentFolderId("parent");
  await runSweep(driveClient);
  return driveClient;
}

