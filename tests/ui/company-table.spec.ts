import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

/**
 * The *Firmy* table with the *Moje firmy* filter, mounted without the server.
 * localStorage only works on a real origin, so the page is served through a
 * route rather than set as content.
 */

const ORIGIN = "https://harness.test";

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { CompanyTable } from "./src/app/companies/company-table";

        const base = {
          openMonth: "2026_01",
          monthKey: "2026_01",
          monthClosed: false,
          proofsArrived: 2,
          lastUploadAt: "2026-01-20T09:00:00.000Z",
          stage: "collect",
        };
        const rows = [
          { ...base, id: 1, driveFolderId: "drive-beta", name: "Beta s.r.o.", groupName: "Eva",
            chaseState: "silent", statementArrivedAt: null, awaitingCount: 0,
            profileMissing: true, structureDeviations: 0, lastUploadAt: null, proofsArrived: 0 },
          { ...base, id: 2, driveFolderId: "drive-gamma", name: "Gamma s.r.o.", groupName: "Katarína",
            chaseState: "decide", statementArrivedAt: "2026-01-05T10:00:00.000Z", awaitingCount: 3,
            profileMissing: false, structureDeviations: 1 },
          { ...base, id: 3, driveFolderId: "drive-delta", name: "Delta s.r.o.", groupName: "Eva",
            chaseState: "ready-to-close", statementArrivedAt: "2026-01-05T10:00:00.000Z", awaitingCount: 0,
            profileMissing: false, structureDeviations: 0, registerStanding: "dissolved" },
          { id: 4, driveFolderId: "drive-epsilon", name: "Epsilon s.r.o.", openMonth: null, monthKey: null,
            monthClosed: false, proofsArrived: 0, statementArrivedAt: null, lastUploadAt: null,
            awaitingCount: null, chaseState: "idle", stage: "idle", profileMissing: false,
            structureDeviations: 0 },
        ];
        const params = new URLSearchParams(window.location.search);
        const email = params.get("email") ?? "jean@example.com";
        createRoot(document.getElementById("root")).render(
          <CompanyTable rows={rows} email={email} selectedMonth={null} />,
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
  });
  bundle = result.outputFiles[0]!.text;
});

const HTML = `<!doctype html><html lang="sk"><head><meta charset="utf-8"></head>
<body><div id="root"></div><script src="${ORIGIN}/bundle.js"></script></body></html>`;

test.beforeEach(async ({ page }) => {
  await page.route(`${ORIGIN}/bundle.js`, (route) =>
    route.fulfill({ contentType: "application/javascript", body: bundle }),
  );
  await page.route((url) => url.origin === ORIGIN && url.pathname === "/", (route) =>
    route.fulfill({ contentType: "text/html", body: HTML }),
  );
});

async function open(page: Page, email = "jean@example.com") {
  await page.goto(`${ORIGIN}/?email=${encodeURIComponent(email)}`);
  await expect(page.getByTestId("scope-all")).toBeVisible();
}

function companyLink(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true });
}

function starFor(page: Page, name: string) {
  return page.getByRole("button", { name: `Moja firma: ${name}`, exact: true });
}

test("a client dissolved in the register is marked on its row, and the mark leads to its profile", async ({ page }) => {
  await open(page);

  const mark = page.getByTestId("company-register-3");
  await expect(mark).toHaveText("Klient zaniknutý v registri");
  await expect(mark).toHaveAttribute("href", "/companies/3/profile");
  await expect(page.getByTestId("company-register-1")).toHaveCount(0);
  await expect(page.getByTestId("company-register-2")).toHaveCount(0);
});

test("blocked localStorage (throwing accessor) shows every company with assignment disabled", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });

  await open(page);

  await expect(page.getByTestId("assignment-unavailable")).toBeVisible();
  await expect(page.getByTestId("scope-all")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scope-mine")).toBeDisabled();
  await expect(page.getByTestId("assign-company-1")).toBeDisabled();
  await expect(companyLink(page, "Epsilon s.r.o.")).toBeVisible();
  await expect(page.getByTestId("summary-awaiting")).toHaveText("3");
  expect(errors).toEqual([]);
});

test("throwing storage methods degrade the same way", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.getItem = function () {
      throw new DOMException("blocked", "SecurityError");
    };
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });

  await open(page);

  await expect(page.getByTestId("assignment-unavailable")).toBeVisible();
  await expect(page.getByTestId("assign-company-2")).toBeDisabled();
  await expect(companyLink(page, "Gamma s.r.o.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a corrupt stored value falls back to Všetky firmy without an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.evaluate(() => {
    window.localStorage.setItem(
      "hugo.assignedCompanies.v1.jean@example.com",
      "{not json",
    );
  });
  await page.reload();

  await expect(page.getByTestId("scope-all")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("assignment-unavailable")).toHaveCount(0);
  await expect(companyLink(page, "Beta s.r.o.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("assigning companies persists across reloads and Moje firmy recounts the summary", async ({ page }) => {
  await open(page);

  // Office-wide: one silent client, and Beta has no profile yet.
  await expect(page.getByTestId("summary-silent")).toHaveText("1");
  await expect(page.getByTestId("summary-profile-missing")).toHaveText("1");

  await starFor(page, "Gamma s.r.o.").click();
  await starFor(page, "Delta s.r.o.").click();
  await expect(starFor(page, "Gamma s.r.o.")).toHaveAttribute("aria-pressed", "true");
  await expect(starFor(page, "Delta s.r.o.")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("scope-mine").click();
  await expect(page.getByTestId("scope-mine")).toHaveAttribute("aria-pressed", "true");
  await expect(companyLink(page, "Beta s.r.o.")).toHaveCount(0);
  await expect(companyLink(page, "Epsilon s.r.o.")).toHaveCount(0);
  await expect(companyLink(page, "Gamma s.r.o.")).toBeVisible();
  await expect(companyLink(page, "Delta s.r.o.")).toBeVisible();
  await expect(page.getByTestId("hidden-count")).toContainText("Skryté: 2 firmy");

  await expect(page.getByTestId("summary-silent")).toHaveText("0");
  await expect(page.getByTestId("summary-profile-missing")).toHaveText("0");
  await expect(page.getByTestId("summary-ready-to-close")).toHaveText("1");
  await expect(page.getByTestId("summary-structure-deviations")).toHaveText("1");
  await expect(page.getByTestId("summary-awaiting")).toHaveText("3");

  // Survives a reload: the same mode, the same assignments.
  await page.reload();
  await expect(page.getByTestId("scope-mine")).toHaveAttribute("aria-pressed", "true");
  await expect(companyLink(page, "Beta s.r.o.")).toHaveCount(0);
  await expect(page.getByTestId("hidden-count")).toContainText("Skryté: 2 firmy");

  // Unmarking drops the company out of the filter again.
  await starFor(page, "Delta s.r.o.").click();
  await expect(companyLink(page, "Delta s.r.o.")).toHaveCount(0);
  await expect(page.getByTestId("hidden-count")).toContainText("Skryté: 3 firmy");

  await page.getByTestId("scope-all").click();
  await expect(companyLink(page, "Beta s.r.o.")).toBeVisible();
  await expect(page.getByTestId("hidden-count")).toHaveCount(0);
  await expect(page.getByTestId("summary-silent")).toHaveText("1");
});

test("an empty Moje firmy shows a hint instead of an empty table", async ({ page }) => {
  await open(page);
  await page.getByTestId("scope-mine").click();

  await expect(page.getByTestId("assigned-empty-hint")).toContainText(
    "Zatiaľ nemáš priradené žiadne firmy. Označ svoje firmy hviezdičkou v zozname Všetky firmy.",
  );
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.getByRole("button", { name: "Zobraziť všetky firmy" }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("two accountants in one browser keep separate lists", async ({ page }) => {
  await open(page, "jean@example.com");
  await starFor(page, "Beta s.r.o.").click();
  await page.getByTestId("scope-mine").click();
  await expect(companyLink(page, "Beta s.r.o.")).toBeVisible();
  await expect(companyLink(page, "Gamma s.r.o.")).toHaveCount(0);

  await open(page, "Colleague@Example.com");
  await expect(page.getByTestId("scope-all")).toHaveAttribute("aria-pressed", "true");
  await expect(starFor(page, "Beta s.r.o.")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("scope-mine").click();
  await expect(page.getByTestId("assigned-empty-hint")).toBeVisible();

  await open(page, "jean@example.com");
  await expect(page.getByTestId("scope-mine")).toHaveAttribute("aria-pressed", "true");
  await expect(companyLink(page, "Beta s.r.o.")).toBeVisible();
});

test("the companies narrow to one accountant's group, and the choice is kept", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("company-group-1")).toHaveText("Eva");

  await page.getByTestId("group-Eva").click();
  await expect(page.getByTestId("company-1")).toBeVisible();
  await expect(page.getByTestId("company-3")).toBeVisible();
  await expect(page.getByTestId("company-2")).toHaveCount(0);
  await expect(page.getByTestId("company-4")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("group-Eva")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("company-2")).toHaveCount(0);

  await page.getByTestId("group-all").click();
  await expect(page.getByTestId("company-2")).toBeVisible();
  await expect(page.getByTestId("company-4")).toBeVisible();
});
