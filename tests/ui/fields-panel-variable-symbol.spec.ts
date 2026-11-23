import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like fields-panel-swap.spec.ts: the panel is bundled and the server's merge is faked.

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

        const FOLDER = "01 Vystavené faktúry";
        // An invoice whose number carries digits and whose printed symbol is missing.
        const extracted = {
          kind: "extracted", source: "model", parties: [],
          documentNumber: "SK-26001", variableSymbol: null, issueDate: "2026-01-10", taxableSupplyDate: null,
          dueDate: null, currency: "EUR", amountCents: 12000, amountLiteral: "120.00", vatRecap: [], docTypeHint: "invoice",
        };
        function documentFor(confirmed, decision) {
          const merged = mergeDocumentFields(extracted, confirmed, { folderSlot: FOLDER, profile: null });
          return {
            id: "vs-document", sameReceiptAs: [], folderSlot: FOLDER, decision, extractionSource: "model",
            canReextract: false, showUidBox: false, outsideEkasa: false, typedEkasaUid: null,
            fieldEditor: { ...merged, fieldChecks: null, docTypeHint: "invoice", arithmeticWarning: null,
              homeCurrency: "EUR", profileCountry: "SK", exportSectionOverride: null, exportSectionResolved: "T01",
              roleContext: { profile: null, enrichmentEnabled: true } },
          };
        }
        function Harness() {
          const [doc, setDoc] = useState(documentFor(emptyConfirmedPayload(), null));
          return <FieldsPanel document={doc} readOnly={false} pending={false} saveState="saved"
            note="" noteDirty={false} onNoteChange={() => {}} onNoteSave={() => {}}
            onLookupUid={() => {}} uidLookupMessage={null} onReextract={() => {}}
            onSave={input => {
              const parsed = parseConfirmedFieldsFromInput(input);
              if (!parsed.ok) throw new Error(parsed.reason);
              setTimeout(() => setDoc(current => documentFor(parsed.payload, current.decision)), 0);
            }}
            onSwapParties={() => {}} />;
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
  await expect(page.getByTestId("field-document-number")).toHaveValue("SK-26001");
});

test("the document number is labelled KV DPH, and the symbol shows its digits as derived", async ({ page }) => {
  await expect(page.locator("label", { has: page.getByTestId("field-document-number") })).toContainText(
    "Číslo dokladu KV DPH",
  );
  const symbol = page.locator("label", { has: page.getByTestId("field-variable-symbol") });
  await expect(page.getByTestId("field-variable-symbol")).toHaveValue("26001");
  await expect(symbol.getByTitle("Hodnota vypočítaná z iných údajov")).toBeVisible();
});

test("a derived symbol follows an edit to the document number", async ({ page }) => {
  await page.getByTestId("field-document-number").fill("FA2026/0012");
  await expect(page.getByTestId("field-variable-symbol")).toHaveValue("20260012");
});

test("a symbol she types stays when the document number is edited", async ({ page }) => {
  await page.getByTestId("field-variable-symbol").fill("777");
  await page.getByTestId("field-document-number").fill("SK-26002");
  await expect(page.getByTestId("field-variable-symbol")).toHaveValue("777");
});
