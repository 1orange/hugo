import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// The month workbench with its server actions stubbed: a link from the export warning (?doc=…)
// selects its document, also when the accountant has moved on and the same link is used again.
// The harness serves a real URL, so the address bar and the history API behave as in the browser.

let html: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { DocumentWorkbench } from "./src/app/companies/[companyId]/[monthKey]/document-workbench";
        import { mergeDocumentFields } from "./src/modules/document-fields";
        import { emptyConfirmedPayload } from "./src/modules/document-payload";

        const CLIENT = { country: "SK", legalName: "Delta, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" };
        const FOLDER = "02 Prijaté faktúry";
        function makeDocument(id, supplierName, issueDate, supplierVerdict, customerVerdict) {
          const extracted = {
            kind: "extracted", source: "model",
            parties: [
              { name: supplierName, ico: "50861930", dic: null, icDph: null },
              { name: CLIENT.legalName, ico: CLIENT.ico, dic: CLIENT.dic, icDph: CLIENT.icDph },
            ],
            documentNumber: id.toUpperCase(), variableSymbol: null, issueDate, taxableSupplyDate: null,
            dueDate: null, currency: "EUR", amountCents: 12000, amountLiteral: "120.00", vatRecap: [], docTypeHint: "invoice",
          };
          const merged = mergeDocumentFields(extracted, emptyConfirmedPayload(), { folderSlot: FOLDER, profile: CLIENT });
          return {
            id, driveFileId: "file-" + id, receiptOfFile: null, sameReceiptAs: [], name: id + ".pdf", folderSlot: FOLDER,
            mimeType: "application/pdf", receiptKind: null, decision: null, decidedAt: null, notRelevantReason: null,
            note: null, label: supplierName, amountDisplay: "120,00 €", receiptDisplay: "—", issueDateDisplay: issueDate,
            derivedStatus: { kind: "awaiting-decision", hint: "" }, extractionFailureReason: null, hasExtractedData: true,
            extractionSource: "model", showUidBox: false, outsideEkasa: false, canReextract: false, typedEkasaUid: null,
            fieldEditor: {
              ...merged, fieldChecks: null, docTypeHint: "invoice", arithmeticWarning: null, vatWarnings: [],
              nonEurCurrency: false, homeCurrency: "EUR", profileCountry: "SK", missingProfile: false,
              roleContext: { profile: CLIENT, enrichmentEnabled: true, directory: {} },
              partyIntegrity: {
                supplier: { verdict: supplierVerdict, findings: [] },
                customer: { verdict: customerVerdict, findings: [] },
              },
              partyIntegrityStored: false, partyIntegrityIdentity: "", exportSectionOverride: null, exportSectionResolved: "T01",
            },
          };
        }
        const DOCUMENTS = [
          makeDocument("alfa", "Alfa s.r.o.", "2026-02-09", "mismatch", "verified"),
          makeDocument("beta", "Beta s.r.o.", "2026-02-05", "verified", "verified"),
          makeDocument("zeta", "Zeta a.s.", "2026-02-03", "valid", "mismatch"),
        ];
        const VIEW = {
          companyName: "Delta", monthKey: "2026_02", readOnly: false, isOpenMonth: true,
          awaitingCount: 3, decidedCount: 0, totalCount: 3, pendingExtractionCount: 0,
          folderFilter: null, folderFilters: [{ slot: FOLDER, shortLabel: "02", count: 3 }],
          sortKey: "issueDate", sortDirection: "desc", homeCurrency: "EUR",
          documents: DOCUMENTS, readOnlyFiles: [], subjectProblems: [],
        };

        const root = createRoot(window.document.getElementById("root"));
        function render() {
          root.render(<DocumentWorkbench companyId={1} monthKey="2026_02" view={VIEW} autoAdvance={false} basePath="/companies/1/2026_02" />);
        }
        // What the export link does: the address changes, and the page renders from the new address.
        window.navigateTo = (url) => { window.history.pushState(null, "", url); render(); };
        render();
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
        name: "harness-stubs",
        setup(build) {
          build.onResolve({ filter: /^\.\.\/\.\.\/actions$/ }, () => ({ path: "actions", namespace: "stub" }));
          build.onResolve({ filter: /server-events$/ }, () => ({ path: "events", namespace: "stub" }));
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
          build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
            const contents: Record<string, string> = {
              actions: [
                "const never = async () => ({ ok: false, message: 'not in the harness' });",
                "export const confirmDocumentAction = never, dismissDocumentAction = never, saveDocumentFieldsAction = never,",
                "  lookupEkasaUidAction = never, reextractDocumentAction = never, saveDocumentNoteAction = never,",
                "  setAdvanceSettlementAction = never, swapDocumentPartiesAction = never, takePartyFromRegisterAction = never,",
                "  takePartyFromProfileAction = never;",
              ].join("\n"),
              events: "export function subscribeServerEvents() { return () => {}; } export function latestQueueView() { return null; }",
              // The address is the source of truth: each render reads it, as the router's search params do.
              navigation: [
                "export function useRouter() { return { push(url) { window.navigateTo(url); }, replace() {}, refresh() {} }; }",
                "export function useSearchParams() { return new URLSearchParams(window.location.search); }",
              ].join("\n"),
              link: 'import React from "react"; export default function Link({ href, children, ...rest }) { return <a href={href} {...rest}>{children}</a>; }',
            };
            return { loader: "tsx", resolveDir: process.cwd(), contents: contents[args.path]! };
          });
        },
      },
    ],
  });
  html = `<!doctype html><html lang="sk"><head><meta charset="utf-8"><title>Harness</title></head><body><div id="root"></div><script>${result.outputFiles[0]!.text}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  await page.route("http://harness.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
});

function navigate(page: import("@playwright/test").Page, url: string) {
  return page.evaluate((next) => (window as unknown as { navigateTo: (u: string) => void }).navigateTo(next), url);
}

function selectedRow(page: import("@playwright/test").Page, id: string) {
  return page.locator(`[data-document-id='${id}'][aria-current='true']`);
}

test("a link with ?doc= selects its document, and the same link works again after moving on", async ({ page }) => {
  await page.goto("http://harness.test/companies/1/2026_02?sort=issueDate&direction=desc");
  await expect(selectedRow(page, "alfa")).toBeVisible();

  await page.getByTestId("document-search").fill("beta");
  await page.locator("[data-document-id='beta']").click();
  await expect(selectedRow(page, "beta")).toBeVisible();

  // The export warning links to Zeta while the rail is narrowed by search.
  await navigate(page, "/companies/1/2026_02?sort=issueDate&direction=desc&doc=zeta");
  await expect(selectedRow(page, "zeta")).toBeVisible();
  await expect(page.getByTestId("document-search")).toHaveValue("", { timeout: 2000 });
  expect(page.url()).not.toContain("doc=");

  await page.locator("[data-document-id='alfa']").click();
  await expect(selectedRow(page, "alfa")).toBeVisible();

  await navigate(page, "/companies/1/2026_02?sort=issueDate&direction=desc&doc=zeta");
  await expect(selectedRow(page, "zeta")).toBeVisible();
});
