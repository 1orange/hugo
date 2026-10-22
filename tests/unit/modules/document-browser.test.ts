import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DOCUMENT_SORT,
  documentMatchesSearch,
  documentBrowserNavigationKey,
  filterDocuments,
  filterReadOnlyFiles,
  normalizeDocumentSearch,
  parseDocumentSortParams,
  projectDocuments,
  sortDocuments,
} from "../../../src/modules/document-browser.ts";
import type { DocumentListItem } from "../../../src/lib/documents/view.ts";

function document(
  id: string,
  values: Partial<{
    label: string;
    name: string;
    supplierName: string;
    customerName: string;
    ico: string;
    dic: string;
    icDph: string;
    customerIco: string;
    customerDic: string;
    customerIcDph: string;
    documentNumber: string;
    variableSymbol: string;
    issueDateAt: string | null;
    issueDateRaw: string;
    amountCents: number | null;
    currency: string;
    status: "pending-extraction" | "manual-entry" | "manual-only" | "awaiting-decision";
    decision: "confirmed" | "not_relevant" | null;
    arithmeticWarning: string | null;
    rolesFlagged: boolean;
    vatWarnings: string[];
  }> = {},
): DocumentListItem {
  return {
    id,
    driveFileId: `file-${id}`,
    receiptOfFile: null,
    sameReceiptAs: [],
    name: values.name ?? `${id}.pdf`,
    folderSlot: "02 Prijaté faktúry",
    mimeType: "application/pdf",
    receiptKind: null,
    decision: values.decision ?? null,
    decidedAt: null,
    notRelevantReason: null,
    note: null,
    label: values.label ?? id,
    amountDisplay: "—",
    receiptDisplay: "—",
    issueDateDisplay: "—",
    derivedStatus: {
      kind: values.status ?? "awaiting-decision",
      hint: "",
    },
    extractionFailureReason: null,
    hasExtractedData: true,
    extractionSource: "model",
    showUidBox: false,
    outsideEkasa: false,
    canReextract: true,
    typedEkasaUid: null,
    fieldEditor: {
      fields: {
        supplierName: values.supplierName ?? "",
        ico: values.ico ?? "",
        dic: values.dic ?? "",
        icDph: values.icDph ?? "",
        customerName: values.customerName ?? "",
        customerIco: values.customerIco ?? "",
        customerDic: values.customerDic ?? "",
        customerIcDph: values.customerIcDph ?? "",
        documentNumber: values.documentNumber ?? "",
        variableSymbol: values.variableSymbol ?? "",
        issueDateRaw: values.issueDateRaw ?? "",
        issueDateAt: values.issueDateAt ?? null,
        taxableSupplyDateRaw: "",
        taxableSupplyDateAt: null,
        dueDateRaw: "",
        dueDateAt: null,
        receiptNumber: "",
        receiptTimestampRaw: "",
        receiptAt: null,
        currency: values.currency ?? "EUR",
        amountLiteral: "",
        amountCents: values.amountCents ?? null,
        recapBaseLiteral: "",
        recapBaseCents: null,
        recapVatLiteral: "",
        recapVatCents: null,
        vatRecap: [],
      },
      provenance: {} as DocumentListItem["fieldEditor"]["provenance"],
      fieldChecks: null,
      docTypeHint: null,
      arithmeticWarning: values.arithmeticWarning ?? null,
      vatWarnings: values.vatWarnings ?? [],
      nonEurCurrency: false,
      homeCurrency: "EUR",
      profileCountry: null,
      rolesFlagged: values.rolesFlagged ?? false,
      missingProfile: false,
      exportSectionOverride: null,
      exportSectionResolved: "T01",
    },
  };
}

test("normalization ignores case, accents, and redundant whitespace", () => {
  assert.equal(normalizeDocumentSearch("  Živnosť  ŠŤ  "), "zivnost st");
});

test("search covers every indexed document field", () => {
  const row = document("one", {
    label: "Dodávateľ",
    name: "invoice-original.pdf",
    supplierName: "Supplier",
    customerName: "Customer",
    documentNumber: "INV-42",
    variableSymbol: "VS-99",
    ico: "111",
    dic: "222",
    icDph: "SK333",
    customerIco: "444",
    customerDic: "555",
    customerIcDph: "SK666",
  });
  for (const query of [
    "dodavatel",
    "original",
    "inv-42",
    "vs-99",
    "supplier",
    "111",
    "222",
    "sk333",
    "customer",
    "444",
    "555",
    "sk666",
  ]) {
    assert.equal(documentMatchesSearch(row, query), true, query);
  }
  assert.deepEqual(filterDocuments([row], "nothing"), []);
});

test("sorting supports date, price, partner, filename, and action-first state", () => {
  const newest = document("new", {
    label: "Železiarstvo",
    name: "z.pdf",
    issueDateAt: "2026-04-20T00:00:00.000Z",
    amountCents: 500,
    status: "awaiting-decision",
  });
  const oldest = document("old", {
    label: "Alfa",
    name: "a.pdf",
    issueDateAt: "2026-04-01T00:00:00.000Z",
    amountCents: 100,
    status: "manual-entry",
  });
  const missing = document("missing", { issueDateAt: null, amountCents: null });
  assert.deepEqual(sortDocuments([oldest, newest, missing], "issueDate", "desc").map((row) => row.id), [
    "new",
    "old",
    "missing",
  ]);
  assert.deepEqual(sortDocuments([oldest, newest, missing], "issueDate", "asc").map((row) => row.id), [
    "old",
    "new",
    "missing",
  ]);
  assert.deepEqual(sortDocuments([oldest, newest], "price", "asc").map((row) => row.id), ["old", "new"]);
  assert.deepEqual(sortDocuments([oldest, newest], "partner", "asc").map((row) => row.id), ["old", "new"]);
  assert.deepEqual(sortDocuments([oldest, newest], "filename", "asc").map((row) => row.id), ["old", "new"]);
  assert.deepEqual(sortDocuments([newest, oldest], "status", "asc").map((row) => row.id), ["old", "new"]);
});

test("VAT warnings join manual-entry states at the front of status sorting", () => {
  const warning = document("warning", {
    status: "awaiting-decision",
    vatWarnings: ["Sadzba DPH nesedí"],
  });
  const clean = document("clean", { status: "awaiting-decision" });
  assert.deepEqual(sortDocuments([clean, warning], "status", "asc").map((row) => row.id), [
    "warning",
    "clean",
  ]);
});

test("price keeps home currency first and does not convert currencies", () => {
  const euro = document("euro", { amountCents: 999, currency: "EUR" });
  const czk = document("czk", { amountCents: 1, currency: "CZK" });
  assert.deepEqual(sortDocuments([czk, euro], "price", "asc", "EUR").map((row) => row.id), ["euro", "czk"]);
});

test("projection filters locally and preserves visible-result count", () => {
  const rows = [document("one", { label: "Alpha" }), document("two", { label: "Beta" })];
  const projected = projectDocuments(rows, { search: "beta" });
  assert.deepEqual(projected.documents.map((row) => row.id), ["two"]);
  assert.equal(projected.totalCount, 2);
});

test("VAT outputs search by filename and remains alphabetic", () => {
  const files = [{ name: "Žiadosť.pdf" }, { name: "01-vystup.pdf" }, { name: "02-vystup.pdf" }];
  assert.deepEqual(filterReadOnlyFiles(files, "VYSTUP").map((file) => file.name), [
    "01-vystup.pdf",
    "02-vystup.pdf",
  ]);
  assert.deepEqual(filterReadOnlyFiles(files, "ziadost").map((file) => file.name), ["Žiadosť.pdf"]);
});

test("sort URL parsing falls back safely and accepts aliases", () => {
  assert.deepEqual(parseDocumentSortParams({}), DEFAULT_DOCUMENT_SORT);
  assert.deepEqual(parseDocumentSortParams({ sort: "price", direction: "asc" }), {
    key: "price",
    direction: "asc",
  });
  assert.deepEqual(parseDocumentSortParams({ sort: "unknown", direction: "sideways" }), DEFAULT_DOCUMENT_SORT);
  assert.deepEqual(parseDocumentSortParams({ sort: "state", dir: "asc" }), {
    key: "status",
    direction: "asc",
  });
});

test("navigation key changes for folder and sort URL state, not ordinary rerenders", () => {
  const base = { folderFilter: null, sortKey: "issueDate" as const, sortDirection: "desc" as const };
  assert.equal(documentBrowserNavigationKey(base), documentBrowserNavigationKey({ ...base }));
  assert.notEqual(
    documentBrowserNavigationKey(base),
    documentBrowserNavigationKey({ ...base, sortDirection: "asc" }),
  );
  assert.notEqual(
    documentBrowserNavigationKey(base),
    documentBrowserNavigationKey({ ...base, folderFilter: "02 Prijaté faktúry" }),
  );
});
