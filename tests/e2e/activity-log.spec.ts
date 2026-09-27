import { test, expect } from "@playwright/test";

test("company activity log lists sweep discoveries", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.goto("/companies/1/activity?type=FileDiscovered");
  await expect(page.getByRole("heading", { name: "Denník aktivity" })).toBeVisible();

  const discovery = page
    .getByTestId("activity-entry")
    .filter({ hasText: "supplier-invoice.pdf" })
    .first();
  await expect(discovery).toBeVisible();
  await expect(discovery.getByText("Nájdený doklad")).toBeVisible();
  await expect(discovery.getByText("Systém")).toBeVisible();
  await expect(discovery.getByText(/prvýkrát videný/)).toBeVisible();
});

test("global activity page is reachable from settings", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();

  await page.getByRole("link", { name: "Nastavenia" }).first().click();
  await page.getByRole("link", { name: "Celý denník aktivity" }).click();

  await expect(page).toHaveURL(/\/activity$/);
  await expect(
    page.getByRole("heading", { name: "Celý denník aktivity" }),
  ).toBeVisible();
});
