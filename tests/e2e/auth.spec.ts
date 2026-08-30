import { test, expect } from "@playwright/test";

test("allowlisted sign-in reaches the company list", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();

  await expect(page).toHaveURL(/\/companies$/);
  await expect(
    page.getByRole("heading", { name: "Companies", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("company-1")).toBeVisible();
  await expect(page.getByText("Beta s.r.o.")).toBeVisible();
  await expect(page.getByText("Open month: 2026_01")).toBeVisible();
  await expect(page.getByTestId("last-sweep-at")).toContainText("Last sweep:");
});

test("non-allowlisted sign-in is refused", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByTestId("e2e-email").fill("stranger@example.com");
  await page.getByTestId("e2e-submit").click();

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("alert")).toContainText(/not on the allowlist/i);
});

test("unauthenticated access to /companies is refused server-side", async ({
  page,
}) => {
  await page.goto("/companies");

  await expect(page).toHaveURL(/\/sign-in/);
});

test("month view groups documents and marks VAT outputs", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.goto("/companies/1/2026_01");
  await expect(page).toHaveURL(/\/companies\/1\/2026_01$/);
  await expect(
    page.getByRole("heading", { name: "02 Prijaté faktúry", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("month-document").filter({ hasText: "supplier-invoice.pdf" }),
  ).toBeVisible();
  await expect(page.getByTestId("folder-group-vat-output")).toBeVisible();
  await expect(page.getByText("vat-output.pdf")).toBeVisible();
  await expect(page.getByRole("heading", { name: "VAT outputs (read-only)" })).toBeVisible();
});

test("refresh button triggers another sweep", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();

  const before = await page.getByTestId("last-sweep-at").getAttribute("data-sweep-at");
  await page.waitForTimeout(1100);
  await page.getByTestId("refresh-sweep").click();
  await expect(page.getByTestId("refresh-sweep")).toHaveText("Refresh", {
    timeout: 10_000,
  });
  const after = await page.getByTestId("last-sweep-at").getAttribute("data-sweep-at");
  expect(after).toBeTruthy();
  expect(after).not.toEqual(before);
});
