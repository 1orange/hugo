import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// The late-arrivals panel on the open month and its note on a closed one. Its server actions are
// stubbed and record what they were asked: the list, the batch button and undo are the surface.

type LateWindow = {
  calls: Array<{ action: string; input: unknown }>;
  renderPanel: (scenario: "open" | "empty" | "closed-source" | "closed-other") => void;
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
        import { LateArrivalsPanel } from "./src/app/companies/[companyId]/[monthKey]/late-arrivals-panel";

        const item = (id, driveFileId, assessment, warning, extra = {}) => ({
          id, driveFileId, name: driveFileId + ".pdf", sourceMonthKey: "2026_09", folderSlot: "02 Prijaté faktúry",
          arrivedAt: "2026-11-12T09:00:00.000Z", status: "pending", assessment, warning, targetMonthKey: null,
          canUndo: false, ...extra,
        });
        const VIEW = {
          targetMonthKey: "2026_11",
          pending: [
            item(1, "late-invoice", { kind: "move", targetMonthKey: "2026_11", targetFolderId: "s-11-02" }, null),
            item(2, "late-statement", { kind: "warning", reason: "not-movable-folder" },
              "Priečinok „03 Bankové výpisy“ patrí k svojmu obdobiu — doklad sa nepresúva.", { folderSlot: "03 Bankové výpisy" }),
          ],
          moved: [item(3, "moved-receipt", null, null, { status: "moved", targetMonthKey: "2026_11", canUndo: true })],
          movableCount: 1,
        };
        const EMPTY = { targetMonthKey: "2026_11", pending: [], moved: [], movableCount: 0 };
        window.renderPanel = (scenario) => {
          const props = {
            open: { monthKey: "2026_11", isTargetMonth: true, view: VIEW },
            empty: { monthKey: "2026_11", isTargetMonth: true, view: EMPTY },
            "closed-source": { monthKey: "2026_09", isTargetMonth: false, view: VIEW },
            "closed-other": { monthKey: "2026_08", isTargetMonth: false, view: VIEW },
          }[scenario];
          createRoot(window.document.getElementById("root")).render(<LateArrivalsPanel companyId={1} {...props} />);
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
        name: "server-stubs",
        setup(build) {
          build.onResolve({ filter: /\.\.\/\.\.\/actions$/ }, () => ({ path: "actions", namespace: "stub" }));
          build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents:
              args.path === "next-link"
                ? 'import React from "react"; export default function Link({ href, children, ...rest }) { return <a href={href} {...rest}>{children}</a>; }'
                : `
                  window.calls = [];
                  const record = (action, input, answer) => { window.calls.push({ action, input }); return Promise.resolve(answer); };
                  export function moveLateArrivalsAction(input) { return record("move", input, { ok: true, moved: 1, failed: [] }); }
                  export function undoLateArrivalMoveAction(input) { return record("undo", input, { ok: false, message: "Doklad bol odvtedy v Drive presunutý inam." }); }
                  export function setLateArrivalIgnoredAction(input) { return record("ignore", input, { ok: true }); }
                `,
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
});

function render(page: import("@playwright/test").Page, scenario: Parameters<LateWindow["renderPanel"]>[0]) {
  return page.evaluate((name) => (window as unknown as LateWindow).renderPanel(name), scenario);
}

function calls(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as unknown as LateWindow).calls);
}

test("the open month lists the proposed move and the warning, and moves the batch in one click", async ({ page }) => {
  await render(page, "open");

  await expect(page.getByTestId("late-arrival-late-invoice")).toHaveAttribute("data-kind", "move");
  await expect(page.getByTestId("late-arrival-late-invoice")).toContainText("→ 2026_11");
  await expect(page.getByTestId("late-arrival-warning-late-statement")).toContainText("nepresúva");

  await page.getByTestId("late-arrivals-move-all").click();
  await expect(page.getByTestId("late-arrivals-message")).toContainText("Presunuté: 1 doklad");
  expect(await calls(page)).toEqual([{ action: "move", input: { companyId: 1 } }]);
});

test("a late arrival can be ignored, and a refused undo says why", async ({ page }) => {
  await render(page, "open");

  await page.getByTestId("late-arrival-ignore-late-statement").click();
  await page.getByTestId("late-arrivals-moved").locator("summary").click();
  await page.getByTestId("late-arrival-undo-moved-receipt").click();

  await expect(page.getByTestId("late-arrivals-message")).toContainText("presunutý inam");
  expect(await calls(page)).toEqual([
    { action: "ignore", input: { companyId: 1, lateArrivalId: 2, ignored: true } },
    { action: "undo", input: { companyId: 1, lateArrivalId: 3 } },
  ]);
});

test("with nothing late the panel is not shown", async ({ page }) => {
  await render(page, "empty");
  await expect(page.getByTestId("late-arrivals")).toHaveCount(0);
});

test("the month it arrived in points to the month being booked", async ({ page }) => {
  await render(page, "closed-source");
  const note = page.getByTestId("late-arrivals-source-note");
  await expect(note).toContainText("Neskoro sem prišli 2 doklady");
  await expect(note).toContainText("v spracúvanom mesiaci");
  await expect(note.getByRole("link", { name: "2026_11" })).toHaveAttribute("href", "/companies/1/2026_11");

  await render(page, "closed-other");
  await expect(page.getByTestId("late-arrivals-source-note")).toHaveCount(0);
});
