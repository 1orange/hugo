import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like document-rail-integrity.spec.ts: the rail, the preview, the decision bar and
// the statement pane, arranged the way the workbench arranges them. The workbench picks the pane
// by the folder (FieldsPanel for proofs, StatementPanel for statements); the harness does the same.

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
        import { DocumentStage } from "./src/app/companies/[companyId]/[monthKey]/document-stage";
        import { DecisionBar } from "./src/app/companies/[companyId]/[monthKey]/decision-bar";
        import { StatementPanel } from "./src/app/companies/[companyId]/[monthKey]/statement-panel";
        import { projectDocuments } from "./src/modules/document-browser";

        const PROOF = "02 Prijaté faktúry";
        const STATEMENT = "03 Bankové výpisy";

        function base(id, label, name, folderSlot, mimeType, extra = {}) {
          return {
            id, driveFileId: "file-" + id, receiptOfFile: null, sameReceiptAs: [], name, folderSlot, mimeType,
            receiptKind: null, decision: null, decidedAt: null, notRelevantReason: null, note: null, label,
            amountDisplay: "—", receiptDisplay: "—", issueDateDisplay: "—", fileDateDisplay: "03.11.2026",
            derivedStatus: { kind: "awaiting-decision", hint: "Čaká na rozhodnutie" },
            extractionFailureReason: null, hasExtractedData: false, extractionSource: null, showUidBox: false,
            outsideEkasa: false, canReextract: false, typedEkasaUid: null,
            fieldEditor: {
              fields: {
                supplierName: "", ico: "", dic: "", icDph: "", customerName: "", customerIco: "", customerDic: "",
                customerIcDph: "", documentNumber: "", variableSymbol: "", issueDateRaw: "", issueDateAt: null,
                taxableSupplyDateRaw: "", taxableSupplyDateAt: null, dueDateRaw: "", dueDateAt: null,
                receiptNumber: "", receiptTimestampRaw: "", receiptAt: null, currency: "EUR", amountLiteral: "",
                amountCents: null, recapBaseLiteral: "", recapBaseCents: null, recapVatLiteral: "",
                recapVatCents: null, vatRecap: [],
              },
              provenance: {}, fieldChecks: null, docTypeHint: null, arithmeticWarning: null, vatWarnings: [],
              nonEurCurrency: false, homeCurrency: "EUR", profileCountry: "SK", rolesFlagged: false, missingProfile: false,
              roleContext: { profile: null, enrichmentEnabled: true, directory: {} },
              partyIntegrity: {
                supplier: { verdict: "unverifiable", findings: [] },
                customer: { verdict: "unverifiable", findings: [] },
              },
              partyIntegrityStored: true, partyIntegrityIdentity: "", exportSectionOverride: null, exportSectionResolved: "T01",
            },
            ...extra,
          };
        }
        const DOCUMENTS = [
          base("faktura", "Alfa s.r.o.", "faktura.pdf", PROOF, "application/pdf", {
            derivedStatus: { kind: "extracted", hint: "Spracované" },
          }),
          base("vypis-pdf", "vypis-pdf", "vypis-november.pdf", STATEMENT, "application/pdf", {
            derivedStatus: { kind: "not-read", hint: "Nečíta sa" },
          }),
          base("vypis-xml", "vypis-xml", "vypis-november.xml", STATEMENT, "application/xml", {
            derivedStatus: { kind: "not-read", hint: "Nečíta sa" },
          }),
        ];

        function Harness() {
          const [documents, setDocuments] = useState(DOCUMENTS);
          const [selected, setSelected] = useState("faktura");
          const [search, setSearch] = useState("");
          const projection = projectDocuments(documents, { search, sortKey: "issueDate", direction: "desc", homeCurrency: "EUR" });
          const current = documents.find((document) => document.id === selected) ?? null;
          const awaiting = documents.filter((document) => document.decision === null).length;
          function confirm() {
            setDocuments((rows) => rows.map((row) => row.id === selected
              ? { ...row, decision: "confirmed", decidedAt: "2026-11-23T10:00:00.000Z" }
              : row));
          }
          return (
            <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr) 380px", height: 720 }}>
              <DocumentRail
                documents={projection.documents}
                folderFilters={[{ slot: PROOF, shortLabel: "02", count: 1 }, { slot: STATEMENT, shortLabel: "03", count: 2 }]}
                folderFilter={null}
                totalCount={documents.length}
                search={search}
                onSearchChange={setSearch}
                sortKey="issueDate"
                sortDirection="desc"
                readOnlyFiles={[]}
                selectedDocumentId={selected}
                liveExtraction={new Map()}
                onSelect={setSelected}
                basePath="/companies/1/2026_11"
                subjectProblemCount={0}
                subjectProblemsOnly={false}
                onSubjectProblemsOnlyChange={() => {}}
              />
              <section style={{ position: "relative", display: "flex", flexDirection: "column" }}>
                <DocumentStage document={current} />
                <DecisionBar
                  document={current}
                  awaitingCount={awaiting}
                  readOnly={false}
                  pending={false}
                  onConfirm={confirm}
                  onDismiss={() => {}}
                  onUndo={() => {}}
                  onStep={() => {}}
                  dismissOpen={false}
                  onOpenDismiss={() => {}}
                  onCloseDismiss={() => {}}
                />
              </section>
              {current && current.folderSlot === STATEMENT
                ? <StatementPanel document={current} />
                : <div data-testid="fields-stub">Polia dokladu</div>}
            </div>
          );
        }
        window.renderBankStatements = () => {
          createRoot(window.document.getElementById("root")).render(<Harness />);
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
  await page.evaluate(() => (window as unknown as { renderBankStatements: () => void }).renderBankStatements());
  await expect(page.getByTestId("document-search")).toBeVisible();
});

test("statements form their own group after the proofs", async ({ page }) => {
  await expect(page.getByTestId("folder-group-statements")).toHaveText("Bankové výpisy");
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-document-id]")).map((row) => (row as HTMLElement).dataset.documentId));
  expect(order).toEqual(["faktura", "vypis-pdf", "vypis-xml"]);
});

test("a PDF statement shows its preview, its name and the decision bar, with no field form", async ({ page }) => {
  await page.locator("[data-document-id='vypis-pdf']").click();

  await expect(page.getByTestId("pdf-preview")).toBeVisible();
  await expect(page.getByTestId("statement-panel")).toContainText("vypis-november.pdf");
  await expect(page.getByTestId("document-field-editor")).toHaveCount(0);
  await expect(page.getByTestId("fields-stub")).toHaveCount(0);
  await expect(page.getByTestId("document-confirm-vypis-pdf")).toBeVisible();
});

test("an XML statement is shown as text, with no field form", async ({ page }) => {
  await page.locator("[data-document-id='vypis-xml']").click();

  await expect(page.getByTestId("text-preview")).toBeVisible();
  await expect(page.getByTestId("pdf-preview")).toHaveCount(0);
  await expect(page.getByTestId("statement-panel")).toContainText("vypis-november.xml");
  await expect(page.getByTestId("document-field-editor")).toHaveCount(0);
});

test("confirming a statement records the decision in place", async ({ page }) => {
  await page.locator("[data-document-id='vypis-pdf']").click();
  await page.getByTestId("document-confirm-vypis-pdf").click();

  await expect(page.getByTestId("decision-chip")).toHaveText("✓ Potvrdené");
  await expect(page.getByTestId("document-confirm-vypis-pdf")).toHaveCount(0);
});
