import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like fields-panel-integrity.spec.ts: the rail with its integrity marker and filter.
// The rail's filter state lives in the workbench, which runs the same projection; the harness does too.

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { DocumentRail } from "./src/app/companies/[companyId]/[monthKey]/document-rail";
        import { projectDocuments } from "./src/modules/document-browser";

        const FOLDER = "02 Prijaté faktúry";
        function row(id, label, supplierVerdict, customerVerdict = "unverifiable", extra = {}) {
          return {
            id, driveFileId: "file-" + id, receiptOfFile: null, sameReceiptAs: [], name: label.toLowerCase() + ".pdf",
            folderSlot: FOLDER, mimeType: "application/pdf", receiptKind: null, decision: null, decidedAt: null,
            notRelevantReason: null, note: null, label, amountDisplay: "120,00 €", receiptDisplay: "—",
            issueDateDisplay: "03.02.2026", derivedStatus: { kind: "awaiting-decision", hint: "" },
            extractionFailureReason: null, hasExtractedData: true, extractionSource: "model", showUidBox: false,
            outsideEkasa: false, canReextract: false, typedEkasaUid: null,
            fieldEditor: {
              fields: {
                supplierName: label, ico: "", dic: "", icDph: "", customerName: "", customerIco: "", customerDic: "",
                customerIcDph: "", documentNumber: "", variableSymbol: "", issueDateRaw: "03.02.2026",
                issueDateAt: "2026-02-03T00:00:00.000Z", taxableSupplyDateRaw: "", taxableSupplyDateAt: null,
                dueDateRaw: "", dueDateAt: null, receiptNumber: "", receiptTimestampRaw: "", receiptAt: null,
                currency: "EUR", amountLiteral: "", amountCents: 12000, recapBaseLiteral: "", recapBaseCents: null,
                recapVatLiteral: "", recapVatCents: null, vatRecap: [],
              },
              provenance: {}, fieldChecks: null, docTypeHint: null, arithmeticWarning: null, vatWarnings: [],
              nonEurCurrency: false, homeCurrency: "EUR", profileCountry: "SK", rolesFlagged: false, missingProfile: false,
              roleContext: { profile: null, enrichmentEnabled: true, directory: {} },
              partyIntegrity: {
                supplier: { verdict: supplierVerdict, findings: [] },
                customer: { verdict: customerVerdict, findings: [] },
              },
              partyIntegrityStored: true, partyIntegrityIdentity: "", exportSectionOverride: null, exportSectionResolved: "T01",
            },
            ...extra,
          };
        }
        const DOCUMENTS = [
          row("alfa", "Alfa s.r.o.", "mismatch"),
          row("beta", "Beta s.r.o.", "verified", "verified"),
          row("gama", "Gama s.r.o.", "notice"),
          row("delta", "Delta s.r.o.", "unverifiable"),
          row("epsilon", "Epsilon s.r.o.", "unavailable"),
          row("zeta", "Zeta a.s.", "valid", "mismatch"),
        ];
        const READ_ONLY = [{ driveFileId: "vat-1", name: "dph-vystup-02.pdf" }];

        function Harness({ documents }) {
          const [search, setSearch] = useState("");
          const [only, setOnly] = useState(false);
          const [selected, setSelected] = useState(documents[0] ? documents[0].id : null);
          const projection = projectDocuments(documents, { search, sortKey: "issueDate", direction: "desc", homeCurrency: "EUR", subjectProblemsOnly: only });
          return <DocumentRail
            documents={projection.documents}
            folderFilters={[{ slot: FOLDER, shortLabel: "02", count: documents.length }]}
            folderFilter={null}
            totalCount={projection.totalCount}
            search={search}
            onSearchChange={setSearch}
            sortKey="issueDate"
            sortDirection="desc"
            readOnlyFiles={READ_ONLY}
            selectedDocumentId={selected}
            liveExtraction={new Map()}
            onSelect={setSelected}
            basePath="/companies/1/2026_02"
            subjectProblemCount={projection.subjectProblemCount}
            subjectProblemsOnly={only}
            onSubjectProblemsOnlyChange={setOnly} />;
        }
        window.renderRail = (name) => {
          const documents = name === "clean" ? DOCUMENTS.filter(d => !["alfa", "zeta"].includes(d.id)) : DOCUMENTS;
          createRoot(window.document.getElementById("root")).render(<Harness documents={documents} />);
        };
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "next-stubs",
        setup(build) {
          build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "stub" }));
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next-navigation", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents: args.path === "next-link"
              ? 'import React from "react"; export default function Link({ href, children, ...rest }) { return <a href={href} {...rest}>{children}</a>; }'
              : 'export function useRouter() { return { push() {}, replace() {}, refresh() {} }; }',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
});

async function renderRail(page: import("@playwright/test").Page, name = "all") {
  await page.evaluate((name) => (window as unknown as { renderRail: (n: string) => void }).renderRail(name), name);
  await expect(page.getByTestId("document-search")).toBeVisible();
}

test("a row with a mismatched party is marked with the warning, and only that row", async ({ page }) => {
  await renderRail(page);

  await expect(page.getByTestId("rail-integrity-alfa")).toBeVisible();
  await expect(page.getByTestId("rail-integrity-alfa")).toHaveAttribute("title", "Strana dokladu nesedí s registrom");
  await expect(page.getByTestId("rail-integrity-zeta"), "a mismatch on the customer side marks too").toBeVisible();

  for (const id of ["beta", "gama", "delta", "epsilon"]) {
    await expect(page.getByTestId(`rail-integrity-${id}`), `${id} is not marked`).toHaveCount(0);
  }
});

test("the integrity filter narrows the rail to mismatched documents and shows visible/total counts", async ({ page }) => {
  await renderRail(page);
  await expect(page.getByTestId("document-count")).toHaveText("6/6");
  const toggle = page.getByTestId("rail-filter-integrity");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("document-count")).toHaveText("2/6");
  await expect(page.locator("[data-testid='month-document-row']")).toHaveCount(2);
  await expect(page.locator("[data-document-id='alfa']")).toBeVisible();
  await expect(page.locator("[data-document-id='zeta']")).toBeVisible();

  await toggle.click();
  await expect(page.getByTestId("document-count")).toHaveText("6/6");
});

test("search composes with the integrity filter", async ({ page }) => {
  await renderRail(page);
  await page.getByTestId("rail-filter-integrity").click();

  await page.getByTestId("document-search").fill("zeta");

  await expect(page.getByTestId("document-count")).toHaveText("1/6");
  await expect(page.locator("[data-document-id='zeta']")).toBeVisible();
  await expect(page.locator("[data-document-id='alfa']")).toHaveCount(0);

  await page.getByTestId("document-search").fill("beta");
  await expect(page.getByTestId("document-count")).toHaveText("0/6");
  await expect(page.getByText("Hľadaniu nezodpovedá žiadny doklad.")).toBeVisible();
});

test("with no mismatched document the filter says so, and the VAT outputs step aside", async ({ page }) => {
  await renderRail(page, "clean");
  await expect(page.getByTestId("folder-group-vat-output")).toBeVisible();

  await page.getByTestId("rail-filter-integrity").click();

  await expect(page.getByTestId("document-count")).toHaveText("0/4");
  await expect(page.getByText("Žiadny doklad nemá problém so subjektom.")).toBeVisible();
  await expect(page.getByTestId("folder-group-vat-output")).toHaveCount(0);
});
