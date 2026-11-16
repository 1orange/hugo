import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like the correction form's: the identity states mounted without the server.
// The restore action comes in as a prop; the router is stubbed, so a success only counts a refresh.

type StatesWindow = {
  restores: Array<{ subjectId: number; field: string }>;
  refreshes: number;
  refuseRestore: boolean;
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
        import { IdentityStateList, IdentityStateSummary } from "./src/components/identity/identity-states";

        window.restores = [];
        window.refreshes = 0;
        window.refuseRestore = false;
        async function onRestore(input) {
          window.restores.push(input);
          if (window.refuseRestore) {
            return { ok: false, message: "Register nemá inú hodnotu, na ktorú by sa dalo vrátiť." };
          }
          return { ok: true };
        }
        const rows = [
          { field: "legalName", label: "Právny názov", value: "Alfa s.r.o.", state: "overene", stateLabel: "overené",
            tone: "good", registerValue: "Alfa s.r.o.", restorable: false },
          { field: "address", label: "Adresa", value: "Hlavná 2, Košice", state: "upravene-rucne", stateLabel: "upravené ručne",
            tone: "warn", registerValue: "Bratislava, Pribinova 25", restorable: true },
          { field: "dic", label: "DIČ", value: "2020311335", state: "neoverene", stateLabel: "neoverené",
            tone: "neutral", registerValue: null, restorable: false },
          { field: "ico", label: "IČO", value: "31333532", state: "overene", stateLabel: "overené",
            tone: "good", registerValue: "31333532", restorable: false },
          { field: "icDph", label: "IČ DPH", value: null, state: "neoverene", stateLabel: "neoverené",
            tone: "neutral", registerValue: null, restorable: false },
        ];
        createRoot(window.document.getElementById("root")).render(
          <>
            <IdentityStateList rows={rows} subjectId={7} onRestore={onRestore} />
            <IdentityStateSummary summary={{ overene: 2, upraveneRucne: 1, neoverene: 1 }} testId="identity-summary" />
          </>,
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
  await expect(page.getByTestId("identity-state-address")).toBeVisible();
});

async function windowState(page: Page): Promise<StatesWindow> {
  return page.evaluate(() => {
    const state = window as unknown as StatesWindow;
    return { restores: state.restores, refreshes: state.refreshes, refuseRestore: state.refuseRestore };
  });
}

test("each field shows its state in Slovak: overené, upravené ručne, neoverené", async ({ page }) => {
  await expect(page.getByTestId("identity-state-legalName")).toHaveText("overené");
  await expect(page.getByTestId("identity-state-ico")).toHaveText("overené");
  await expect(page.getByTestId("identity-state-address")).toHaveText("upravené ručne");
  await expect(page.getByTestId("identity-state-dic")).toHaveText("neoverené");
  await expect(page.getByTestId("identity-state-icDph")).toHaveText("neoverené");
  await expect(page.getByTestId("identity-state-address")).toHaveAttribute("data-state", "upravene-rucne");
});

test("a hand edit shows the register's value beside it; the other states show none", async ({ page }) => {
  await expect(page.getByTestId("identity-value-address")).toHaveText("Hlavná 2, Košice");
  await expect(page.getByTestId("identity-register-address")).toHaveText("Bratislava, Pribinova 25");
  await expect(page.getByTestId("identity-register-legalName")).toHaveCount(0);
  await expect(page.getByTestId("identity-register-dic")).toHaveCount(0);
  await expect(page.getByTestId("identity-restore-legalName")).toHaveCount(0);
  await expect(page.getByTestId("identity-restore-dic")).toHaveCount(0);
});

test("the one-click return restores the register's value, and the page is refreshed", async ({ page }) => {
  await page.getByTestId("identity-restore-address").click();

  await expect.poll(async () => (await windowState(page)).refreshes).toBe(1);
  expect((await windowState(page)).restores).toEqual([{ subjectId: 7, field: "address" }]);
});

test("a return the server refuses shows its message and refreshes nothing", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as StatesWindow).refuseRestore = true;
  });
  await page.getByTestId("identity-restore-address").click();

  await expect(page.getByTestId("identity-restore-address").locator("xpath=..").getByRole("alert")).toHaveText(
    "Register nemá inú hodnotu, na ktorú by sa dalo vrátiť.",
  );
  expect((await windowState(page)).refreshes).toBe(0);
});

test("the list's summary counts the fields in each state", async ({ page }) => {
  await expect(page.getByTestId("identity-summary")).toContainText("2 overené");
  await expect(page.getByTestId("identity-summary")).toContainText("1 upravené ručne");
  await expect(page.getByTestId("identity-summary")).toContainText("1 neoverené");
});
