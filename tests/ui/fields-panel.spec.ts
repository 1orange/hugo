import { test, expect } from "@playwright/test";
import { build } from "esbuild";

type HarnessWindow = { saveCount: number; refreshDocument: () => void };

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

        const initial = mergeDocumentFields({}, emptyConfirmedPayload());
        initial.fields.vatRecap = [{ rateLiteral: "23", baseLiteral: "100.00", baseCents: 10000, vatLiteral: "23.00", vatCents: 2300 }];
        const initialDocument = {
          id: "test-document", sameReceiptAs: [],
          fieldEditor: { ...initial, fieldChecks: null, homeCurrency: "EUR", exportSectionResolved: "T01" },
        };
        window.saveCount = 0;
        function Harness() {
          const [document, setDocument] = useState(initialDocument);
          window.refreshDocument = () => setDocument(current => ({ ...current }));
          return <FieldsPanel document={document} readOnly={false} pending={false} saveState="saved"
            note="" noteDirty={false} onNoteChange={() => {}} onNoteSave={() => {}}
            onLookupUid={() => {}} uidLookupMessage={null} onReextract={() => {}}
            onSave={input => {
              window.saveCount++;
              const parsed = parseConfirmedFieldsFromInput(input);
              if (!parsed.ok) throw new Error(parsed.reason);
              const merged = mergeDocumentFields({}, parsed.payload);
              // A save response arrives after the local draft has updated.
              setTimeout(() => setDocument(current => ({ ...current, fieldEditor: { ...current.fieldEditor, ...merged } })), 0);
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
  await expect(page.getByTestId("field-vat-rate-0")).toHaveValue("23");
});

test("a new VAT row survives save responses and refreshes until filled", async ({ page }) => {
  await page.getByTestId("add-vat-recap-row").click();
  await expect(page.getByTestId("vat-recap-row-1")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).saveCount)).toBe(0);
  await page.evaluate(() => (window as unknown as HarnessWindow).refreshDocument());
  await expect(page.getByTestId("vat-recap-row-1")).toBeVisible();
  // Saving an unrelated field must also keep the empty local row.
  await page.getByTestId("field-supplier-name").fill("Supplier");
  await page.getByTestId("field-supplier-name").blur();
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).saveCount)).toBe(1);
  await expect(page.getByTestId("vat-recap-row-1")).toBeVisible();
  await expect(page.getByTestId("save-document-fields")).toBeDisabled();
  await page.getByTestId("field-vat-rate-1").fill("5");
  await page.getByTestId("field-vat-rate-1").blur();
  await page.getByTestId("field-vat-base-1").fill("10,00");
  await page.getByTestId("field-vat-base-1").blur();
  await page.getByTestId("field-vat-amount-1").fill("0,50");
  await page.getByTestId("field-vat-amount-1").blur();
  await page.evaluate(() => (window as unknown as HarnessWindow).refreshDocument());
  await expect(page.getByTestId("field-vat-rate-1")).toHaveValue("5");
  await expect(page.getByTestId("field-vat-base-1")).toHaveValue("10,00");
  await expect(page.getByTestId("field-vat-amount-1")).toHaveValue("0,50");
  await page.getByRole("button", { name: "Odstrániť sadzbu 2" }).click();
  await expect(page.getByTestId("vat-recap-row-1")).toHaveCount(0);
});

for (const id of ["field-amount", "field-recap-base", "field-recap-vat", "field-vat-rate-0", "field-vat-base-0", "field-vat-amount-0"]) {
  test(id + " accepts decimals and rejects non-numeric input", async ({ page }) => {
    const input = page.getByTestId(id);
    await input.fill("");
    await input.pressSequentially("12abc3,45");
    await expect(input).toHaveValue("123,45");
    for (const invalid of ["EUR 12", "1e3", "-12", "+12", "1,2.3", "12.345", "12 34"]) {
      await input.fill(invalid);
      await expect(input).toHaveValue("123,45");
    }
    await input.fill("123.");
    await expect(input).toHaveValue("123.");
    await input.pressSequentially("45");
    await expect(input).toHaveValue("123.45");
    await input.fill("");
    await expect(input).toHaveValue("");
  });
}
