import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Own harness: the advance settlement is shown only for a settled invoice, and
// her toggle goes to the server as a decision (PRD 0004 issue 11).

type AdvanceWindow = {
  toggleCount: number;
  lastToggle: boolean | null;
  setScenario: (name: string) => void;
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
        import { applyAdvanceSettlement } from "./src/modules/advance-settlement";

        const CLIENT = { country: "SK", legalName: "Acme s.r.o.", ico: "31333532", dic: "2020311335", icDph: "SK2020311335" };
        const FOLDER = "02 Prijaté faktúry";
        const row = (rate, baseCents, vatCents) => ({
          rateLiteral: rate, baseLiteral: (baseCents / 100).toFixed(2), baseCents,
          vatLiteral: (vatCents / 100).toFixed(2), vatCents,
        });
        const plain = (amountCents, vatRecap) => ({
          kind: "extracted", source: "model",
          parties: [{ name: "Dodávateľ s.r.o.", ico: null, dic: null, icDph: "SK2020449189" }],
          documentNumber: "5022606206", variableSymbol: null, issueDate: "2026-05-11", taxableSupplyDate: "2026-05-11",
          dueDate: null, currency: "EUR", amountCents, amountLiteral: (amountCents / 100).toFixed(2), vatRecap,
          docTypeHint: "invoice",
        });
        const SETTLED_LINES = [
          "Rekapitulácia DPH daňového dokladu 5022606206",
          "Sadzba | Základ DPH | Čiastka DPH | Celkom s DPH",
          "23% | 364,65 | 83,87 | 448,52",
          "Celkom | 364,65 | 83,87 | 448,52",
          "Celkom uhradených záloh: | 448,52 EUR",
          "Zálohové doklady č. : 5926010455 | 448,52 | EUR",
          "Celkom k úhrade vrátane DPH | 0,00 | EUR",
        ];
        // The same document with the advance misread: 448,25 for 448,52.
        const MISREAD_LINES = SETTLED_LINES.map(line =>
          line.startsWith("Celkom uhradených záloh") ? "Celkom uhradených záloh: | 448,25 EUR" : line);
        const SCENARIOS = {
          settled: applyAdvanceSettlement(plain(0, [row("23", 36465, 8387)]), SETTLED_LINES),
          plain: plain(12300, [row("23", 10000, 2300)]),
          misread: applyAdvanceSettlement(plain(0, [row("23", 36465, 8387)]), MISREAD_LINES),
          undetected: plain(0, [row("23", 36465, 8387)]),
        };

        function documentFor(name, confirmed, decided) {
          const merged = mergeDocumentFields(SCENARIOS[name], confirmed, { folderSlot: FOLDER, profile: CLIENT });
          return {
            id: "advance-document", sameReceiptAs: [], folderSlot: FOLDER, decision: decided ? "confirmed" : null,
            extractionSource: "model", canReextract: false, showUidBox: false, outsideEkasa: false, typedEkasaUid: null,
            fieldEditor: { ...merged, fieldChecks: null, docTypeHint: "invoice", arithmeticWarning: null,
              homeCurrency: "EUR", profileCountry: "SK", exportSectionOverride: null, exportSectionResolved: "T01",
              roleContext: { profile: CLIENT, enrichmentEnabled: true },
              advanceSettlementOverride: confirmed.advanceSettlement ? confirmed.advanceSettlement.settled : null,
              advanceSettlementAvailable: true },
          };
        }

        window.toggleCount = 0;
        window.lastToggle = null;
        window.saveCount = 0;
        function Harness() {
          const [state, setState] = useState({ scenario: "settled", confirmed: {}, decided: false });
          window.setScenario = name => setState({ scenario: name, confirmed: {}, decided: false });
          window.setDecided = value => setState(current => ({ ...current, decided: value }));
          const document = documentFor(state.scenario, state.confirmed, state.decided);
          return <FieldsPanel document={document} readOnly={false} pending={false} saveState="saved"
            note="" noteDirty={false} onNoteChange={() => {}} onNoteSave={() => {}}
            onLookupUid={() => {}} uidLookupMessage={null} onReextract={() => {}}
            onSwapParties={() => {}}
            onSave={input => {
              window.saveCount++;
              const parsed = parseConfirmedFieldsFromInput(input);
              if (!parsed.ok) throw new Error(parsed.reason);
              setTimeout(() => setState(current => ({
                ...current,
                confirmed: { ...parsed.payload, advanceSettlement: current.confirmed.advanceSettlement },
              })), 0);
            }}
            onSetAdvanceSettlement={settled => {
              window.toggleCount++;
              window.lastToggle = settled;
              // The server answers with the saved document, as a refresh would.
              setTimeout(() => setState(current => ({
                ...current,
                confirmed: { advanceSettlement: { settled, source: "manual" } },
              })), 0);
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
  await expect(page.getByTestId("field-amount")).toBeVisible();
});

async function useScenario(page: import("@playwright/test").Page, name: string) {
  await page.evaluate((scenario) => (window as unknown as AdvanceWindow).setScenario(scenario), name);
}

test("a settled invoice shows the advance, the amount due, the references and the hint", async ({ page }) => {
  await expect(page.getByTestId("advance-deducted")).toHaveValue("448,52");
  await expect(page.getByTestId("amount-due")).toHaveValue("0,00");
  await expect(page.getByTestId("advance-documents")).toContainText("Zálohové doklady: 5926010455");
  await expect(page.getByTestId("advance-settlement-hint")).toHaveText(
    "Vyúčtovanie zálohy — k úhrade 0,00, účtuje sa plná suma",
  );
  await expect(page.getByTestId("advance-settlement-toggle")).toBeChecked();
  // The total is the supply, not the amount due.
  await expect(page.getByTestId("field-amount")).toHaveValue("448.52");
  await expect(page.getByTestId("advance-identity-warning")).toHaveCount(0);
});

test("a plain invoice shows none of the settlement fields, hint or references", async ({ page }) => {
  await useScenario(page, "plain");
  await expect(page.getByTestId("advance-deducted")).toHaveCount(0);
  await expect(page.getByTestId("amount-due")).toHaveCount(0);
  await expect(page.getByTestId("advance-documents")).toHaveCount(0);
  await expect(page.getByTestId("advance-settlement-hint")).toHaveCount(0);
  await expect(page.getByTestId("advance-settlement-toggle")).not.toBeChecked();
  await expect(page.getByTestId("field-amount")).toHaveValue("123.00");
});

test("an advance that breaks total − advance = due shows a warning", async ({ page }) => {
  await useScenario(page, "misread");
  await expect(page.getByTestId("advance-identity-warning")).toContainText(
    "Odpočet zálohy nesedí: celkom − záloha ≠ k úhrade",
  );
  // The settlement itself still applies: the warning flags it, it does not undo it.
  await expect(page.getByTestId("advance-settlement-hint")).toBeVisible();
});

test("a consistent advance shows no identity warning", async ({ page }) => {
  await useScenario(page, "settled");
  await expect(page.getByTestId("advance-identity-warning")).toHaveCount(0);
});

test("unticking the toggle restores the plain extraction", async ({ page }) => {
  await page.getByTestId("advance-settlement-toggle").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as AdvanceWindow).lastToggle)).toBe(false);
  await expect(page.getByTestId("advance-settlement-toggle")).not.toBeChecked();
  await expect(page.getByTestId("advance-settlement-hint")).toHaveCount(0);
  await expect(page.getByTestId("advance-deducted")).toHaveCount(0);
  await expect(page.getByTestId("field-amount")).toHaveValue("0.00");
  await expect(page.getByTestId("field-recap-vat")).toHaveValue("83.87");
});

test("ticking the toggle on an undetected invoice applies the settlement", async ({ page }) => {
  await useScenario(page, "undetected");
  await expect(page.getByTestId("advance-settlement-toggle")).not.toBeChecked();
  await page.getByTestId("advance-settlement-toggle").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as AdvanceWindow).lastToggle)).toBe(true);
  await expect(page.getByTestId("advance-settlement-toggle")).toBeChecked();
  await expect(page.getByTestId("field-amount")).toHaveValue("448.52");
  await expect(page.getByTestId("advance-deducted")).toHaveValue("448,52");
  await expect(page.getByTestId("advance-settlement-hint")).toHaveText(
    "Vyúčtovanie zálohy — k úhrade 0,00, účtuje sa plná suma",
  );
});

test("a decided invoice can still have its settlement changed, as its fields can", async ({ page }) => {
  await page.evaluate(() => (window as unknown as AdvanceWindow).setDecided(true));
  await expect(page.getByTestId("advance-settlement-toggle")).toBeEnabled();
});
