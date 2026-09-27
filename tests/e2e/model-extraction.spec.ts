import { test, expect } from "@playwright/test";

test("pending invoice fills from stub extractor and corrections persist", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.getByTestId("company-profile-setup-1").click();
  await page.getByTestId("profile-candidate-31333532").click();
  await page.getByTestId("profile-ic-dph").fill("SK7120001713");
  await page.getByTestId("profile-save").click();
  await expect(page).toHaveURL(/saved=1/, { timeout: 15_000 });

  await page.goto("/companies/1/2026_01");
  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "supplier-invoice.pdf" })
    .click();

  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Dodávateľ s.r.o.", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("extraction-source-badge")).toHaveText("Model");

  await page.getByTestId("field-document-number").fill("20260999");
  await page.getByTestId("field-document-number").blur();

  await page.reload();
  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "supplier-invoice.pdf" })
    .click();

  await expect(page.getByTestId("field-document-number")).toHaveValue("20260999");
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Dodávateľ s.r.o.");
});
