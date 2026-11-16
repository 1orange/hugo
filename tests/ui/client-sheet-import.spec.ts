import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { FIXTURE_CSV } from "../unit/support/client-sheet-fixture";

// Own harness, like the other specs: the client-sheet import mounted without the server.
// The actions run the real pure module on the made-up fixture companies, so the counts
// on the page are the counts a write would make.

type SheetWindow = {
  applyCalls: Array<{ confirmedRows: number[]; tickedFields: string[] }>;
  previews: number;
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
        import { ClientSheetImport } from "./src/app/settings/clients/client-sheet-import";
        import { parseClientSheet, planClientSheet, selectClientSheetWrites } from "./src/modules/client-sheet";
        import { FIXTURE_COMPANIES, FIXTURE_PROFILES } from "./tests/unit/support/client-sheet-fixture";

        window.applyCalls = [];
        window.previews = 0;

        async function previewAction(text) {
          window.previews += 1;
          const parsed = parseClientSheet(text);
          if (!parsed.ok) {
            return { ok: false, message: parsed.message };
          }
          return { ok: true, data: planClientSheet(parsed.rows, FIXTURE_COMPANIES, FIXTURE_PROFILES) };
        }

        async function applyAction(text, decisions) {
          window.applyCalls.push(decisions);
          const parsed = parseClientSheet(text);
          const plan = planClientSheet(parsed.rows, FIXTURE_COMPANIES, FIXTURE_PROFILES);
          const writes = selectClientSheetWrites(plan, decisions);
          return {
            ok: true,
            data: { companies: writes.length, fields: writes.reduce((total, write) => total + write.written.length, 0) },
          };
        }

        createRoot(document.getElementById("root")).render(
          <ClientSheetImport previewAction={previewAction} applyAction={applyAction} />,
        );
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
});

async function chooseSheet(page: Page, csv: string) {
  await page.getByTestId("client-sheet-file").setInputFiles({
    name: "klienti.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
}

async function windowState(page: Page) {
  return page.evaluate(() => {
    const state = window as unknown as SheetWindow;
    return { applyCalls: state.applyCalls, previews: state.previews };
  });
}

test("choosing the sheet shows every group of rows and writes nothing", async ({ page }) => {
  await chooseSheet(page, FIXTURE_CSV);

  await expect(page.getByTestId("client-sheet-summary")).toHaveText(
    "Riadkov 6: nové 1, zmenené 2, bez zmeny 1, bez IČO 0, neplatné 1, nespárované 1, nesúlady 2, odhady podľa názvu 1.",
  );
  await expect(page.getByTestId("section-new")).toContainText("Beta Štúdio s.r.o.");
  await expect(page.getByTestId("section-changed")).toContainText("Alfa s.r.o.");
  await expect(page.getByTestId("section-invalid")).toContainText("nemá osem číslic");
  await expect(page.getByTestId("section-unmatched")).toContainText("Neznáma");
  await expect(page.getByTestId("section-disagreements")).toContainText("na Drive je v skupine „Katarína“");
  await expect(page.getByTestId("section-unchanged")).toContainText("Bez zmeny: 1");

  // Hand-saved Alfa address: the old value is shown, and it is written only when ticked.
  await expect(page.getByTestId("row-1")).toContainText("Pod Hradom 1, Bratislava");
  await expect(page.getByTestId("tick-1-address")).not.toBeChecked();

  await expect(page.getByTestId("client-sheet-write-count")).toHaveText("Zapíše sa 2 firmy, 5 polí.");
  expect((await windowState(page)).applyCalls).toEqual([]);
});

test("the write count follows her choices: a confirmed guess and a ticked change", async ({ page }) => {
  await chooseSheet(page, FIXTURE_CSV);
  const count = page.getByTestId("client-sheet-write-count");

  await expect(count).toHaveText("Zapíše sa 2 firmy, 5 polí.");

  await page.getByTestId("confirm-2").check();
  await expect(count).toHaveText("Zapíše sa 3 firmy, 10 polí.");

  await page.getByTestId("tick-1-address").check();
  await expect(count).toHaveText("Zapíše sa 3 firmy, 11 polí.");

  await page.getByTestId("confirm-2").uncheck();
  await expect(count).toHaveText("Zapíše sa 2 firmy, 6 polí.");
});

test("confirming sends only her decisions and reports what was written, then shows the sheet as it stands", async ({ page }) => {
  await chooseSheet(page, FIXTURE_CSV);
  await page.getByTestId("confirm-2").check();
  await page.getByTestId("tick-1-address").check();

  await page.getByTestId("client-sheet-apply").click();

  await expect(page.getByTestId("client-sheet-done")).toHaveText("Zapísané: 3 firmy, 11 polí.");
  expect((await windowState(page)).applyCalls).toEqual([{ confirmedRows: [2], tickedFields: ["1:address"] }]);
  // The preview was made again after the write.
  await expect.poll(async () => (await windowState(page)).previews).toBeGreaterThanOrEqual(2);
});

test("a sheet that lacks a column is refused with the column named, and no plan is shown", async ({ page }) => {
  await chooseSheet(page, FIXTURE_CSV.replace("Sídlo", "Adresa"));

  await expect(page.getByRole("alert")).toHaveText("V tabuľke chýba stĺpec „Sídlo“.");
  await expect(page.getByTestId("client-sheet-summary")).toHaveCount(0);
  await expect(page.getByTestId("client-sheet-apply")).toHaveCount(0);
});
