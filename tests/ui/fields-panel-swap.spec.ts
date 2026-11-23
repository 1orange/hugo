import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

// Own harness: the VAT-row hooks in fields-panel.spec.ts would run for these tests too.

type SwapWindow = {
  swapCount: number;
  lastSwap: { fields: { supplierName: string }; partyProvenance: Record<string, string> } | null;
  holdResponses: boolean;
  respond: () => void;
  setReadOnly: (value: boolean) => void;
  setPending: (value: boolean) => void;
  setDecided: (value: boolean) => void;
};

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

        const CLIENT = { country: "SK", legalName: "Delta s.r.o.", ico: "31333532", dic: "2020311335", icDph: "SK2020311335" };
        const FOLDER = "02 Prijaté faktúry";
        // The client is the customer of a received invoice, and its DIČ is missing from the document.
        const extracted = {
          kind: "extracted", source: "model",
          parties: [
            { name: "Alfa s.r.o.", ico: "11111111", dic: "1111111111", icDph: "SK1111111111" },
            { name: "Delta s.r.o.", ico: "31333532", dic: null, icDph: "SK2020311335" },
          ],
          documentNumber: "FA-7", variableSymbol: null, issueDate: "2026-01-10", taxableSupplyDate: null,
          dueDate: null, currency: "EUR", amountCents: 12000, amountLiteral: "120.00", vatRecap: [], docTypeHint: "invoice",
        };
        function documentFor(confirmed, decision) {
          const merged = mergeDocumentFields(extracted, confirmed, { folderSlot: FOLDER, profile: CLIENT });
          return {
            id: "swap-document", sameReceiptAs: [], folderSlot: FOLDER, decision, extractionSource: "model",
            canReextract: false, showUidBox: false, outsideEkasa: false, typedEkasaUid: null,
            fieldEditor: { ...merged, fieldChecks: null, docTypeHint: "invoice", arithmeticWarning: null,
              homeCurrency: "EUR", profileCountry: "SK", exportSectionOverride: null, exportSectionResolved: "T01",
              roleContext: { profile: CLIENT, enrichmentEnabled: true } },
          };
        }
        window.swapCount = 0;
                window.lastSwap = null;
        window.holdResponses = false;
        function Harness() {
          const [doc, setDoc] = useState(documentFor(emptyConfirmedPayload(), null));
          const [readOnly, setReadOnly] = useState(false);
          const [pending, setPending] = useState(false);
          // The server answers with the saved document, as a refresh would.
          function respondWith(confirmed) {
            const respond = () => setDoc(current => documentFor(confirmed, current.decision));
            if (window.holdResponses) {
              window.respond = respond;
            } else {
              setTimeout(respond, 0);
            }
          }
          window.setReadOnly = setReadOnly;
          window.setPending = setPending;
          window.setDecided = value => setDoc(current => ({ ...current, decision: value ? "confirmed" : null }));
          return <FieldsPanel document={doc} readOnly={readOnly} pending={pending} saveState="saved"
            note="" noteDirty={false} onNoteChange={() => {}} onNoteSave={() => {}}
            onLookupUid={() => {}} uidLookupMessage={null} onReextract={() => {}}
            onSave={input => {
              const parsed = parseConfirmedFieldsFromInput(input);
              if (!parsed.ok) throw new Error(parsed.reason);
              respondWith(parsed.payload);
            }}
            onSwapParties={(input, partyProvenance) => {
              window.swapCount++;
              window.lastSwap = { fields: input, partyProvenance };
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
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Alfa s.r.o.");
});

async function swapCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as SwapWindow).swapCount);
}

test("the swap moves each party field and its badge to the other side, and back", async ({ page }) => {
  await expect(page.getByTestId("swap-parties")).toBeEnabled();
  const supplierDic = page.locator("label", { has: page.getByTestId("field-dic") });
  const customerDic = page.locator("label", { has: page.getByTestId("field-customer-dic") });
  // The client's DIČ was missing from the document, so the profile supplied it.
  await expect(page.getByTestId("field-customer-dic")).toHaveValue("2020311335");
  await expect(customerDic.getByTitle("Hodnota z profilu firmy")).toBeVisible();

  await page.getByTestId("swap-parties").click();

  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Delta s.r.o.");
  await expect(page.getByTestId("field-customer-name")).toHaveValue("Alfa s.r.o.");
  await expect(page.getByTestId("field-dic")).toHaveValue("2020311335");
  await expect(supplierDic.getByTitle("Hodnota z profilu firmy")).toBeVisible();
  await expect(page.getByTestId("field-customer-dic")).toHaveValue("1111111111");
  await expect(customerDic.getByTitle("Hodnota z dokladu")).toBeVisible();
  await expect(customerDic.getByTitle("Hodnota z profilu firmy")).toHaveCount(0);

  await page.getByTestId("swap-parties").click();

  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Alfa s.r.o.");
  await expect(page.getByTestId("field-customer-name")).toHaveValue("Delta s.r.o.");
  await expect(page.getByTestId("field-customer-dic")).toHaveValue("2020311335");
  await expect(customerDic.getByTitle("Hodnota z profilu firmy")).toBeVisible();
});

test("the swap is saved as the swapped values with the provenance they carry", async ({ page }) => {
  await page.getByTestId("swap-parties").click();

  await expect.poll(() => page.evaluate(() => (window as unknown as SwapWindow).lastSwap?.fields.supplierName)).toBe("Delta s.r.o.");
  const saved = await page.evaluate(() => (window as unknown as SwapWindow).lastSwap!.partyProvenance);
  expect(Object.keys(saved).sort()).toEqual([
    "customerDic", "customerIcDph", "customerIco", "customerName",
    "dic", "icDph", "ico", "supplierName",
  ]);
  expect(saved.dic).toBe("profile");
  expect(saved.supplierName).toBe("extracted");
  expect(saved.customerDic).toBe("extracted");
});

test("role warnings appear and clear at once, before the saved document comes back", async ({ page }) => {
  await page.evaluate(() => { (window as unknown as SwapWindow).holdResponses = true; });
  await expect(page.getByTestId("party-roles-flagged")).toHaveCount(0);

  await page.getByTestId("swap-parties").click();
  await expect(page.getByTestId("party-roles-flagged")).toBeVisible();

  await page.getByTestId("swap-parties").click();
  await expect(page.getByTestId("party-roles-flagged")).toHaveCount(0);

  await page.evaluate(() => (window as unknown as SwapWindow).respond());
  await expect(page.getByTestId("party-roles-flagged")).toHaveCount(0);
});

test("the swap button is disabled for read-only and saving documents, not for decided ones", async ({ page }) => {
  const button = page.getByTestId("swap-parties");
  await expect(button).toBeEnabled();

  await page.evaluate(() => (window as unknown as SwapWindow).setReadOnly(true));
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", "Mesiac je uzavretý — strany sa nedajú meniť");
  await page.evaluate(() => (window as unknown as SwapWindow).setReadOnly(false));

  // A decided document's parties can still be mended, as its fields can.
  await page.evaluate(() => (window as unknown as SwapWindow).setDecided(true));
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("title", "Vymeniť strany (X)");
  await page.evaluate(() => (window as unknown as SwapWindow).setDecided(false));

  await page.evaluate(() => (window as unknown as SwapWindow).setPending(true));
  await expect(button).toBeDisabled();
  await page.evaluate(() => (window as unknown as SwapWindow).setPending(false));

  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("title", "Vymeniť strany (X)");
});

test("the X key swaps the parties, and does nothing while typing or when locked", async ({ page }) => {
  await page.keyboard.press("x");
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Delta s.r.o.");
  expect(await swapCount(page)).toBe(1);

  // The fixture's number "FA-7" derives the symbol "7" (issue 13); clear it so the typed x is the whole value.
  await page.getByTestId("field-variable-symbol").fill("");
  await page.getByTestId("field-variable-symbol").click();
  await page.keyboard.press("x");
  await expect(page.getByTestId("field-variable-symbol")).toHaveValue("x");
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Delta s.r.o.");
  expect(await swapCount(page)).toBe(1);

  await page.getByTestId("field-variable-symbol").blur();
  await page.keyboard.press("Control+x");
  expect(await swapCount(page)).toBe(1);

  await page.evaluate(() => (window as unknown as SwapWindow).setReadOnly(true));
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("x");
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Delta s.r.o.");
  expect(await swapCount(page)).toBe(1);
});

test("a swap keeps unsaved edits she made in the parties", async ({ page }) => {
  await page.getByTestId("field-supplier-name").fill("Alfa Holding s.r.o.");
  await page.getByTestId("swap-parties").click();

  await expect(page.getByTestId("field-customer-name")).toHaveValue("Alfa Holding s.r.o.");
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Delta s.r.o.");
  const saved = await page.evaluate(() => (window as unknown as SwapWindow).lastSwap!.partyProvenance);
  expect(saved.customerName).toBe("confirmed");
});
