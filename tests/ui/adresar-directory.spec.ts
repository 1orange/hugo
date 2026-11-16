import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Own harness, like the other specs: the Adresár's table mounted without the server. The client
// filter is the same predicate the server uses (isClientSubject), applied to three made-up subjects:
// a client company's profile, an office client with no company, and a counterparty.

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { DirectoryTable } from "./src/app/adresar/directory-table";
        import { isClientSubject } from "./src/modules/subject-directory";

        const SUBJECTS = [
          { id: 1, name: "Alfa s.r.o.", linkedCompanyId: 1, officeClient: false, keeper: "Eva", cooperation: "aktívna" },
          { id: 2, name: "Delta, s.r.o.", linkedCompanyId: null, officeClient: true, keeper: "Katarína", cooperation: "ukončená" },
          { id: 3, name: "Kappa s.r.o.", linkedCompanyId: null, officeClient: false, keeper: null, cooperation: null },
        ];

        // The row the list shows for a subject: a client's mark links to its company, an office client has none.
        function rowOf(subject) {
          return {
            id: subject.id,
            country: "SK",
            name: subject.name,
            ico: "36000001",
            dic: null,
            icDph: null,
            verdict: "unverified",
            verdictLabel: "neoverené",
            verdictTone: "neutral",
            lastSeenLabel: "16. 11. 2026",
            client: isClientSubject(subject)
              ? { href: subject.linkedCompanyId === null ? null : "/companies/" + subject.linkedCompanyId + "/activity" }
              : null,
            keeper: subject.keeper,
            cooperation: subject.cooperation,
            identity: { overene: 0, upraveneRucne: 0, neoverene: 4 },
          };
        }

        function Harness() {
          const [clientsOnly, setClientsOnly] = useState(false);
          const shown = (clientsOnly ? SUBJECTS.filter(isClientSubject) : SUBJECTS).map(rowOf);
          return (
            <>
              <button type="button" data-testid="scope-all" onClick={() => setClientsOnly(false)}>Všetky</button>
              <button type="button" data-testid="scope-clients" onClick={() => setClientsOnly(true)}>Klienti</button>
              <DirectoryTable rows={shown} />
            </>
          );
        }

        createRoot(window.document.getElementById("root")).render(<Harness />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    // next/link reads process.env: the browser has none, so the harness supplies an empty one.
    banner: { js: "var process = { env: { NODE_ENV: 'test' } };" },
    define: { "process.env.NODE_ENV": '"test"' },
  });
  bundle = result.outputFiles[0]!.text;
});

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
});

// A page that throws renders nothing useful: a test on the table would only see missing rows.
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("the Klienti filter keeps the linked clients and the office clients, and drops a counterparty", async ({ page }) => {
  await expect(page.getByTestId(/^directory-row-/)).toHaveCount(3);

  await page.getByTestId("scope-clients").click();
  await expect(page.getByTestId(/^directory-row-/)).toHaveCount(2);
  await expect(page.getByTestId("directory-row-1")).toBeVisible();
  await expect(page.getByTestId("directory-row-2")).toBeVisible();
  await expect(page.getByTestId("directory-row-3")).toHaveCount(0);

  await page.getByTestId("scope-all").click();
  await expect(page.getByTestId(/^directory-row-/)).toHaveCount(3);
});

test("a client's mark: a linked company links to it, an office client has no company to link to", async ({ page }) => {
  const linked = page.getByTestId("directory-client-1");
  await expect(linked).toHaveText("Klient");
  await expect(linked).toHaveAttribute("href", "/companies/1/activity");

  const office = page.getByTestId("directory-client-2");
  await expect(office).toHaveText("Klient");
  expect(await office.evaluate((element) => element.tagName)).toBe("SPAN");
  await expect(page.getByTestId("directory-client-3")).toHaveCount(0);
});

test("the office's accountant and cooperation show beside each subject, and a dash where there is none", async ({ page }) => {
  await expect(page.getByTestId("directory-keeper-2")).toHaveText("Katarína");
  await expect(page.getByTestId("directory-cooperation-2")).toHaveText("ukončená");
  await expect(page.getByTestId("directory-keeper-1")).toHaveText("Eva");
  await expect(page.getByTestId("directory-cooperation-1")).toHaveText("aktívna");
  await expect(page.getByTestId("directory-keeper-3")).toHaveText("—");
  await expect(page.getByTestId("directory-cooperation-3")).toHaveText("—");
});
