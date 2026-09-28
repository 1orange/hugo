import { test, expect } from "@playwright/test";
import { resetE2eData } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

test("company profile setup from fake register persists and clears chase marker", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await expect(page.getByTestId("company-profile-missing-1")).toBeVisible();

  await page.getByTestId("company-profile-setup-1").click();
  await expect(page).toHaveURL(/\/companies\/1\/profile$/);

  await expect(page.getByTestId("profile-candidate-31333532")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("profile-candidate-31333532").click();
  await expect(page).toHaveURL(/ico=31333532/);
  await expect(page.getByTestId("profile-dic")).toHaveValue("2020311335", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("profile-legal-name")).toHaveValue("Beta s.r.o.");
  await expect(page.getByTestId("profile-ic-dph")).toHaveValue("");

  await page.getByTestId("profile-ic-dph").fill("SK7120001713");
  await page.getByTestId("profile-save").click();
  await expect(page).toHaveURL(/saved=1/, { timeout: 15_000 });
  await expect(page.getByTestId("profile-message")).toContainText("uložený");

  await page.goto("/companies");
  await expect(page.getByTestId("company-profile-missing-1")).toHaveCount(0);

  await page.goto("/companies/1/profile");
  await expect(page.getByTestId("profile-legal-name")).toHaveValue("Beta s.r.o.");
  await expect(page.getByTestId("profile-ic-dph")).toHaveValue("SK7120001713");
});

test("czech company profile from fake ARES shows CZK without foreign-currency warning", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await expect(page.getByTestId("company-profile-missing-2")).toBeVisible();

  await page.goto("/companies/2/profile?country=CZ");
  await expect(page.getByRole("heading", { name: "Vyhľadať v ARES" })).toBeVisible();

  await expect(page.getByTestId("profile-candidate-87654321")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("profile-candidate-87654321").click();
  await expect(page).toHaveURL(/ico=87654321/);
  await expect(page.getByRole("heading", { name: "Vyhľadať v ARES" })).toBeVisible();
  await expect(page.getByTestId("profile-dic")).toHaveValue("CZ87654321");
  await expect(page.getByTestId("profile-ic-dph")).toHaveCount(0);

  await page.getByTestId("profile-save").click();
  await expect(page).toHaveURL(/saved=1/, { timeout: 15_000 });

  await page.goto("/companies/2/2026_01");
  await expect(page.getByTestId("document-panel")).toBeVisible();
  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "CZ Test Shop" })
    .click();
  await expect(page.getByTestId("non-eur-warning")).toHaveCount(0);
});
