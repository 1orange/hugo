import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DOCUMENT_SORT,
  documentMatchesSearch,
  documentBrowserNavigationKey,
  filterDocuments,
  filterReadOnlyFiles,
  hasSubjectProblem,
  normalizeDocumentSearch,
  parseDocumentSortParams,
  projectDocuments,
  sortDocuments,
} from "../../../src/modules/document-browser.ts";
import type { DocumentListItem } from "../../../src/lib/documents/view.ts";
import type { IntegrityVerdict } from "../../../src/modules/subject-integrity.ts";

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
    supplierVerdict: IntegrityVerdict;
    customerVerdict: IntegrityVerdict;
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
    fileDateDisplay: "02.02.2026",
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
      roleContext: { profile: null, enrichmentEnabled: true, directory: {} },
      partyIntegrity: {
        supplier: { verdict: values.supplierVerdict ?? "unverifiable", findings: [] },
        customer: { verdict: values.customerVerdict ?? "unverifiable", findings: [] },
      },
      partyIntegrityStored: false,
      partyIntegrityIdentity: "",
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

test("bank statements form their own group after the other documents, in either direction", () => {
  const statement = { ...document("statement", { issueDateAt: "2026-05-30T00:00:00.000Z" }), folderSlot: "03 Bankové výpisy" as const };
  const older = document("older", { issueDateAt: "2026-04-01T00:00:00.000Z" });
  const newer = document("newer", { issueDateAt: "2026-04-20T00:00:00.000Z" });
  // The statement is the newest of all: date order alone would put it first.
  assert.deepEqual(sortDocuments([statement, older, newer], "issueDate", "desc").map((row) => row.id), [
    "newer",
    "older",
    "statement",
  ]);
  assert.deepEqual(sortDocuments([older, statement, newer], "issueDate", "asc").map((row) => row.id), [
    "older",
    "newer",
    "statement",
  ]);
  assert.deepEqual(sortDocuments([statement, older], "partner", "asc").map((row) => row.id), ["older", "statement"]);
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

test("a party verdict of mismatch marks the document, and only that verdict", () => {
  const verdicts: IntegrityVerdict[] = ["verified", "valid", "notice", "unverifiable", "unavailable"];
  for (const verdict of verdicts) {
    assert.equal(hasSubjectProblem(document("d", { supplierVerdict: verdict, customerVerdict: verdict })), false, verdict);
  }
  assert.equal(hasSubjectProblem(document("supplier", { supplierVerdict: "mismatch" })), true);
  assert.equal(hasSubjectProblem(document("customer", { customerVerdict: "mismatch" })), true);
  assert.equal(
    hasSubjectProblem(document("notice", { supplierVerdict: "notice", customerVerdict: "notice" })),
    false,
    "a notice is worth a look but does not mark the row",
  );
});

test("the integrity filter narrows to mismatched documents and composes with search and sort", () => {
  const rows = [
    document("alfa", { label: "Alfa", issueDateAt: "2026-04-01T00:00:00.000Z", supplierVerdict: "mismatch" }),
    document("beta", { label: "Beta", issueDateAt: "2026-04-03T00:00:00.000Z", customerVerdict: "mismatch" }),
    document("gamma", { label: "Gamma", issueDateAt: "2026-04-02T00:00:00.000Z", supplierVerdict: "notice" }),
    document("delta", { label: "Alfa Delta", issueDateAt: "2026-04-05T00:00:00.000Z" }),
  ];

  const onlyProblems = projectDocuments(rows, { subjectProblemsOnly: true });
  assert.deepEqual(onlyProblems.documents.map((row) => row.id), ["beta", "alfa"], "newest first, mismatches only");
  assert.equal(onlyProblems.subjectProblemsOnly, true);
  assert.equal(onlyProblems.subjectProblemCount, 2);
  assert.equal(onlyProblems.totalCount, 4, "the total is the scope, not the filtered list");

  const withSearch = projectDocuments(rows, { subjectProblemsOnly: true, search: "alfa" });
  assert.deepEqual(withSearch.documents.map((row) => row.id), ["alfa"]);
  assert.equal(withSearch.subjectProblemCount, 2, "the count names the scope's problems, not the search's");

  const ascending = projectDocuments(rows, {
    subjectProblemsOnly: true,
    sortKey: "issueDate",
    direction: "asc",
  });
  assert.deepEqual(ascending.documents.map((row) => row.id), ["alfa", "beta"]);

  const off = projectDocuments(rows, { subjectProblemsOnly: false });
  assert.equal(off.documents.length, 4, "the filter is off unless asked for");
});

test("the integrity filter keeps the folder scope it is given", () => {
  const scoped = [
    document("in-folder", { supplierVerdict: "mismatch" }),
    document("other-folder", { supplierVerdict: "unverifiable" }),
  ];
  const projected = projectDocuments([scoped[1]!], { subjectProblemsOnly: true });
  assert.deepEqual(projected.documents, []);
  assert.equal(projected.subjectProblemCount, 0);
  assert.equal(projected.totalCount, 1);
  assert.deepEqual(projectDocuments(scoped, { subjectProblemsOnly: true }).documents.map((row) => row.id), ["in-folder"]);
});

test("an empty integrity filter reports zero problems and no rows", () => {
  const rows = [document("clean"), document("unknown", { supplierVerdict: "unavailable" })];
  const projected = projectDocuments(rows, { subjectProblemsOnly: true });
  assert.deepEqual(projected.documents, []);
  assert.equal(projected.subjectProblemCount, 0);
  assert.equal(projected.totalCount, 2);
});
