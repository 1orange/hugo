import { test, expect } from "@playwright/test";
import { documentRow, resetE2eData } from "./helpers";
import { bookingMonthKey } from "../../src/modules/month-lifecycle.ts";
import { monthLabel } from "../../src/modules/format-sk.ts";

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

test("allowlisted sign-in reaches the chase list", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();

  await expect(page).toHaveURL(/\/companies$/);
  await expect(page.getByTestId("company-1")).toBeVisible();
  await expect(page.getByText("Beta s.r.o.")).toBeVisible();
  // Firmy opens on the booking month (ADR 0015, 2026-11-23). The fixture only has
  // January, so the row says the month is not there and links to the open month.
  const booking = bookingMonthKey(new Date());
  await expect(page.getByTestId("chase-month-picker")).toContainText(monthLabel(booking));
  await expect(page.getByTestId("company-stage-1")).toContainText("Tento mesiac tu nie je");
  await expect(page.getByTestId("company-1")).toHaveAttribute("href", "/companies/1/2026_01");
  await expect(page.getByTestId("last-sweep-at")).toContainText("Drive načítaný");

  // The open-months view is the one that shows the fixture's January.
  await page.goto("/companies?month=open");
  await expect(page.getByTestId("company-1")).toBeVisible();
  // The e2e fixture has no `03 Bankové výpisy` folder, so the chase state is
  // "statement missing" rather than "decide" — presence, not an expectation.
  await expect(page.getByTestId("company-stage-1")).toContainText(
    "Vypýtať bankový výpis",
  );
  // Both seeded companies show a month; this one is company 1's.
  await expect(
    page.getByRole("row").filter({ has: page.getByTestId("company-1") }).getByText("január 2026"),
  ).toBeVisible();
  // Five: the blank receipt for the UID-box spec joined the fixture.
  await expect(page.getByTestId("company-awaiting-1")).toContainText("5");
  await expect(page.getByTestId("last-sweep-at")).toContainText("Drive načítaný");
});

test("non-allowlisted sign-in is refused", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByTestId("e2e-email").fill("stranger@example.com");
  await page.getByTestId("e2e-submit").click();

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("alert")).toContainText(/nie je na zozname povolených/i);
});

test("unauthenticated access to /companies is refused server-side", async ({
  page,
}) => {
  await page.goto("/companies");

  await expect(page).toHaveURL(/\/sign-in/);
});

test("the workbench filters by folder and surfaces VAT outputs read-only", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.goto("/companies/1/2026_01");
  await expect(page).toHaveURL(/\/companies\/1\/2026_01$/);

  // Folders are a filter, not navigation, and every processed slot has a chip.
  await expect(
    page.getByTestId("folder-filter").filter({ hasText: "02" }),
  ).toBeVisible();
  await expect(
    documentRow(page, "e2e-doc-supplier"),
  ).toBeVisible();

  // VAT outputs live at the month root and are never documents.
  await expect(page.getByTestId("folder-group-vat-output")).toBeVisible();
  await expect(page.getByText("vat-output.pdf")).toBeVisible();
  await expect(page.getByTestId("folder-group-vat-output")).toContainText(
    "Výstupy DPH",
  );
});

test("the chase list can be pointed at a specific month", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  // The default view is the booking month.
  await expect(
    page.getByTestId(`chase-month-${bookingMonthKey(new Date())}`),
  ).toHaveAttribute("aria-current", "page");

  // Otvorené mesiace is each company's own open month, with a URL of its own.
  await page.getByTestId("chase-month-picker").click();
  await page.getByTestId("chase-month-open").click();
  await expect(page).toHaveURL(/\/companies\?month=open$/);
  await expect(page.getByTestId("chase-month-open")).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByTestId("chase-month-picker").click();
  await page.getByTestId("chase-month-2026_01").click();
  await expect(page).toHaveURL(/\/companies\?month=2026_01$/);
  await expect(page.getByTestId("chase-month-2026_01")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Vybraný mesiac")).toBeVisible();
  await expect(page.getByTestId("company-1")).toBeVisible();

  // A row still opens that month's workbench.
  await page.getByTestId("company-1").click();
  await expect(page).toHaveURL(/\/companies\/1\/2026_01$/);
});

test("refresh button triggers another sweep", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();

  const before = await page.getByTestId("last-sweep-at").getAttribute("data-sweep-at");
  await page.waitForTimeout(1100);
  await page.getByTestId("refresh-sweep").click();
  // The button is an icon; its name says when the sweep is done.
  await expect(page.getByTestId("refresh-sweep")).toHaveAccessibleName("Obnoviť", { timeout: 10_000 });
  await expect(page.getByTestId("last-sweep-at")).not.toHaveAttribute("data-sweep-at", before ?? "", {
    timeout: 10_000,
  });
  const after = await page.getByTestId("last-sweep-at").getAttribute("data-sweep-at");
  expect(after).toBeTruthy();
});
