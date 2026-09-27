import { test, expect } from "@playwright/test";

test("allowlisted sign-in reaches the chase list", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();

  await expect(page).toHaveURL(/\/companies$/);
  await expect(page.getByTestId("company-1")).toBeVisible();
  await expect(page.getByText("Beta s.r.o.")).toBeVisible();
  // The e2e fixture has no `03 Bankové výpisy` folder, so the chase state is
  // "statement missing" rather than "decide" — presence, not an expectation.
  await expect(page.getByTestId("company-stage-1")).toContainText(
    "Vypýtať bankový výpis",
  );
  await expect(page.getByText("január 2026")).toBeVisible();
  await expect(page.getByTestId("company-awaiting-1")).toContainText("4");
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
    page.getByTestId("month-document-row").filter({ hasText: "supplier-invoice.pdf" }),
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

  // The default view is each company's own open month.
  await expect(page.getByTestId("chase-month-open")).toHaveAttribute(
    "aria-current",
    "page",
  );

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
  await expect(page.getByTestId("refresh-sweep")).toHaveText("Obnoviť", {
    timeout: 10_000,
  });
  const after = await page.getByTestId("last-sweep-at").getAttribute("data-sweep-at");
  expect(after).toBeTruthy();
  expect(after).not.toEqual(before);
});
