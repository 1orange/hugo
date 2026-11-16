import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like fields-panel-swap.spec.ts: the party verdicts next to each fieldset.

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { FieldsPanel } from "./src/app/companies/[companyId]/[monthKey]/fields-panel";
        import { mergeDocumentFields, parseConfirmedFieldsFromInput } from "./src/modules/document-fields";
        import { emptyConfirmedPayload } from "./src/modules/document-payload";

        // Delta, a. s. is hers: IČO, DIČ and IČ DPH all check out.
        const CLIENT = { country: "SK", legalName: "Delta, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" };
        const FOLDER = "02 Prijaté faktúry";
        // Received invoice: the counterparty Beta is the supplier, Delta the customer.
        const extracted = {
          kind: "extracted", source: "model",
          parties: [
            { name: "Beta s.r.o.", ico: "50861930", dic: null, icDph: null },
            { name: "Delta, a. s.", ico: "31322832", dic: "2020372640", icDph: "SK2020372640" },
          ],
          documentNumber: "FA-9", variableSymbol: null, issueDate: "2026-01-10", taxableSupplyDate: null,
          dueDate: null, currency: "EUR", amountCents: 12000, amountLiteral: "120.00", vatRecap: [], docTypeHint: "invoice",
        };
        function documentFor(confirmed, decision) {
          const merged = mergeDocumentFields(extracted, confirmed, { folderSlot: FOLDER, profile: CLIENT });
          return {
            id: "integrity-document", sameReceiptAs: [], folderSlot: FOLDER, decision, extractionSource: "model",
            canReextract: false, showUidBox: false, outsideEkasa: false, typedEkasaUid: null,
            fieldEditor: { ...merged, fieldChecks: null, docTypeHint: "invoice", arithmeticWarning: null,
              homeCurrency: "EUR", profileCountry: "SK", exportSectionOverride: null, exportSectionResolved: "T01",
              roleContext: { profile: CLIENT, enrichmentEnabled: true } },
          };
        }
        window.swapCount = 0;
        function Harness() {
          const [doc, setDoc] = useState(documentFor(emptyConfirmedPayload(), null));
          function respondWith(confirmed) {
            setTimeout(() => setDoc(current => documentFor(confirmed, current.decision)), 0);
          }
          return <FieldsPanel document={doc} readOnly={false} pending={false} saveState="saved"
            note="" noteDirty={false} onNoteChange={() => {}} onNoteSave={() => {}}
            onLookupUid={() => {}} uidLookupMessage={null} onReextract={() => {}}
            onSave={input => {
              const parsed = parseConfirmedFieldsFromInput(input);
              if (!parsed.ok) throw new Error(parsed.reason);
              respondWith(parsed.payload);
            }}
            onSwapParties={(input, partyProvenance) => {
              window.swapCount++;
              const parsed = parseConfirmedFieldsFromInput(input);
              if (!parsed.ok) throw new Error(parsed.reason);
              respondWith({ ...parsed.payload, partyProvenance });
            }} />;
        }
        createRoot(window.document.getElementById("root")).render(<Harness />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  bundle = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Beta s.r.o.");
});

test("each party shows its verdict beside its fieldset", async ({ page }) => {
  const supplier = page.getByTestId("party-integrity-supplier");
  const customer = page.getByTestId("party-integrity-customer");
  await expect(supplier).toHaveText("Formálne v poriadku");
  await expect(customer).toHaveText("Overené");
  await expect(customer).toHaveAttribute("data-verdict", "verified");
  // The badge sits in its own fieldset's legend.
  await expect(page.locator("fieldset", { has: supplier }).locator("legend")).toContainText("Dodávateľ");
  await expect(page.locator("fieldset", { has: customer }).locator("legend")).toContainText("Odberateľ");
  await expect(page.getByTestId("party-integrity-findings-supplier")).toHaveCount(0);
});

test("a wrong IČO is flagged while she types, and clears when corrected", async ({ page }) => {
  const supplier = page.getByTestId("party-integrity-supplier");
  await page.getByTestId("field-ico").fill("50861931");
  await expect(supplier).toHaveText("Nesúhlasí");
  await expect(page.getByTestId("party-integrity-findings-supplier")).toContainText(
    "IČO nemá platnú kontrolnú číslicu",
  );

  await page.getByTestId("field-ico").fill("50861930");
  await expect(supplier).toHaveText("Formálne v poriadku");
  await expect(page.getByTestId("party-integrity-findings-supplier")).toHaveCount(0);
});

test("the client's IČO that differs from the profile is a mismatch naming the profile's IČO", async ({ page }) => {
  const customer = page.getByTestId("party-integrity-customer");
  await page.getByTestId("field-customer-ico").fill("50861930");
  await expect(customer).toHaveText("Nesúhlasí");
  await expect(page.getByTestId("party-integrity-findings-customer")).toContainText(
    "IČO nezodpovedá profilu klienta — v profile: 31322832.",
  );
});

test("the verdicts move with the parties through a swap", async ({ page }) => {
  const supplier = page.getByTestId("party-integrity-supplier");
  const customer = page.getByTestId("party-integrity-customer");
  await expect(customer).toHaveText("Overené");

  await page.getByTestId("swap-parties").click();

  // Her company is now the supplier of a received invoice: checked offline only,
  // and the counterparty on the customer side is what the profile does not match.
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Delta, a. s.");
  await expect(supplier).toHaveText("Formálne v poriadku");
  await expect(customer).toHaveText("Nesúhlasí");
  await expect(page.getByTestId("party-integrity-findings-customer")).toContainText(
    "Názov nezodpovedá profilu klienta",
  );

  await page.getByTestId("swap-parties").click();

  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Beta s.r.o.");
  await expect(supplier).toHaveText("Formálne v poriadku");
  await expect(customer).toHaveText("Overené");
});
