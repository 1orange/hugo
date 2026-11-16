import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

// The Omega export panel with its pre-export integrity warning. Its server actions are stubbed:
// the warning and the export button are the surface under test, not the register-backed preview.

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { OmegaExportPanel } from "./src/app/companies/[companyId]/[monthKey]/omega-export-panel";

        const BASE = "/companies/1/2026_02";
        const PROBLEMS = [
          { documentId: "alfa", label: "Alfa s.r.o.", fileName: "alfa.pdf", href: BASE + "?sort=issueDate&direction=desc&doc=alfa" },
          { documentId: "zeta", label: "Zeta a.s.", fileName: "zeta.pdf", href: BASE + "?sort=issueDate&direction=desc&doc=zeta" },
        ];
        window.renderExport = (problems) => {
          createRoot(window.document.getElementById("root")).render(
            <OmegaExportPanel companyId={1} monthKey="2026_02" integrityProblems={problems ? PROBLEMS : []} />
          );
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
          build.onResolve({ filter: /omega-export-actions$/ }, () => ({ path: "export-actions", namespace: "stub" }));
          build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents: args.path === "next-link"
              ? 'import React from "react"; export default function Link({ href, children, ...rest }) { return <a href={href} {...rest}>{children}</a>; }'
              : "export async function previewOmegaExportAction() { throw new Error('not in the harness'); } export async function downloadOmegaExportAction() { return { ok: false, message: 'not in the harness' }; }",
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

async function openExport(page: Page, problems: boolean): Promise<void> {
  await page.evaluate((withProblems) => (window as unknown as { renderExport: (p: boolean) => void }).renderExport(withProblems), problems);
  await page.getByTestId("omega-export-button").click();
}

test("the export button counts the documents to check, and its popover lists each, linking to it", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { renderExport: (p: boolean) => void }).renderExport(true));
  await expect(page.getByTestId("omega-export-button")).toContainText("2");
  await page.getByTestId("omega-export-button").click();

  const warning = page.getByTestId("export-integrity-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("2");
  await expect(warning.getByRole("link", { name: /Alfa s\.r\.o\./ })).toHaveAttribute(
    "href",
    "/companies/1/2026_02?sort=issueDate&direction=desc&doc=alfa",
  );
  await expect(warning.getByRole("link", { name: /Zeta a\.s\./ })).toHaveAttribute(
    "href",
    "/companies/1/2026_02?sort=issueDate&direction=desc&doc=zeta",
  );
});

test("the warning does not block the export", async ({ page }) => {
  await openExport(page, true);

  await expect(page.getByTestId("export-integrity-warning")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stiahnuť TXT" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Náhľad" })).toBeEnabled();
});

test("without a mismatched party there is no warning", async ({ page }) => {
  await openExport(page, false);

  await expect(page.getByTestId("omega-export-panel")).toBeVisible();
  await expect(page.getByTestId("export-integrity-warning")).toHaveCount(0);
});
