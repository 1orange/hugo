import { test, expect } from "@playwright/test";

test("allowlisted sign-in reaches the company list", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();

  await expect(page).toHaveURL(/\/companies$/);
  await expect(
    page.getByRole("heading", { name: "Companies", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No companies yet")).toBeVisible();
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
