import { test, expect } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies/);
}

test("the app bar shows a dot until Novinky is opened, and lists what changed", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("nav-novinky")).toHaveAttribute("data-unread", "true");
  await expect(page.getByTestId("nav-novinky-dot")).toBeVisible();

  await page.getByTestId("nav-novinky").click();
  await expect(page).toHaveURL(/\/novinky$/);
  await expect(page.getByRole("heading", { level: 1, name: "Novinky" })).toBeVisible();
  await expect(page.getByText("Doklady sa čítajú hneď po nahratí")).toBeVisible();

  await page.goto("/companies");
  await expect(page.getByTestId("nav-novinky")).toHaveAttribute("data-unread", "false");
  await expect(page.getByTestId("nav-novinky-dot")).toHaveCount(0);
});
