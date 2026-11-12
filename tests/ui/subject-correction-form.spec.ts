import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like the fields-panel specs: the *Adresár* correction form mounted without the server.
// The action comes in as a prop; the router is stubbed, so a save only counts a refresh.

type CorrectionWindow = {
  calls: Array<{ subjectId: number; field: string; value: string }>;
  refreshes: number;
};

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { SubjectCorrectionForm } from "./src/app/adresar/subject-correction-form";

        window.calls = [];
        window.refreshes = 0;
        // The server refuses an IČ DPH that is not divisible by eleven, as the action does.
        async function onCorrect(input) {
          window.calls.push(input);
          if (input.field === "icDph" && input.value === "SK2020322899") {
            return { ok: false, message: "Slovenské IČ DPH musí byť deliteľné 11." };
          }
          return { ok: true, changed: true };
        }
        createRoot(window.document.getElementById("root")).render(
          <SubjectCorrectionForm
            subjectId={7}
            onCorrect={onCorrect}
            fields={[
              { field: "legalName", label: "Názov", value: "Alfa s.r.o." },
              { field: "address", label: "Adresa", value: "Bratislava" },
              { field: "dic", label: "DIČ", value: "2020322832" },
              { field: "icDph", label: "IČ DPH", value: "SK2020322832" },
              { field: "vatGroupId", label: "IČ DPH skupiny", value: null },
            ]}
          />,
        );
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
        name: "router-stub",
        setup(build) {
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next-navigation", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents:
              "export function useRouter() { return { refresh() { window.refreshes = (window.refreshes || 0) + 1; } }; }",
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
  await expect(page.getByTestId("subject-field-input-legalName")).toHaveValue("Alfa s.r.o.");
});

async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as CorrectionWindow).calls);
}

test("the fields show the subject's values and an empty VAT group", async ({ page }) => {
  await expect(page.getByTestId("subject-field-input-dic")).toHaveValue("2020322832");
  await expect(page.getByTestId("subject-field-input-icDph")).toHaveValue("SK2020322832");
  await expect(page.getByTestId("subject-field-input-vatGroupId")).toHaveValue("");
});

test("saving with nothing changed says so and corrects nothing", async ({ page }) => {
  await page.getByTestId("subject-correct-submit").click();

  await expect(page.getByTestId("subject-correct-error")).toHaveText("Nič sa nezmenilo.");
  expect(await calls(page)).toEqual([]);
});

test("each changed field is corrected on its own, with the value typed, and the page refreshes", async ({ page }) => {
  await page.getByTestId("subject-field-input-legalName").fill("Alfa Holding s.r.o.");
  await page.getByTestId("subject-field-input-dic").fill("2020322899");
  await page.getByTestId("subject-correct-submit").click();

  await expect(page.getByTestId("subject-correct-saved")).toHaveText("Úpravy uložené (2).");
  expect(await calls(page)).toEqual([
    { subjectId: 7, field: "legalName", value: "Alfa Holding s.r.o." },
    { subjectId: 7, field: "dic", value: "2020322899" },
  ]);
  await expect.poll(() => page.evaluate(() => (window as unknown as CorrectionWindow).refreshes)).toBe(1);
});

test("a refused correction shows its message under its field and sends no later field", async ({ page }) => {
  await page.getByTestId("subject-field-input-icDph").fill("SK2020322899");
  await page.getByTestId("subject-field-input-vatGroupId").fill("SK7120001713");
  await page.getByTestId("subject-correct-submit").click();

  await expect(page.getByTestId("subject-field-input-icDph").locator("xpath=..").getByRole("alert")).toHaveText(
    "IČ DPH: Slovenské IČ DPH musí byť deliteľné 11.",
  );
  // The VAT group comes after the IČ DPH in the form: it is not sent once that is refused.
  expect(await calls(page)).toEqual([{ subjectId: 7, field: "icDph", value: "SK2020322899" }]);
  await expect(page.getByTestId("subject-correct-saved")).toHaveCount(0);
  await expect(page.getByTestId("subject-correct-error")).toHaveCount(0);
});
