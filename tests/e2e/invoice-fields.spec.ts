import { test, expect } from "@playwright/test";

test("invoice with both parties persists and matches company profile", async ({ page }) => {
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

  await page.getByTestId("field-supplier-name").fill("Dodávateľ s.r.o.");
  await page.getByTestId("field-ico").fill("87654321");
  await page.getByTestId("field-customer-name").fill("Beta s.r.o.");
  await page.getByTestId("field-customer-ico").fill("31333532");
  await page.getByTestId("field-customer-ic-dph").fill("SK7120001713");
  await page.getByTestId("field-document-number").fill("20260077");
  await page.getByTestId("field-variable-symbol").fill("20260077");
  await page.getByTestId("field-issue-date").fill("10.01.2026");
  await page.getByTestId("field-taxable-supply-date").fill("10.01.2026");
  await page.getByTestId("field-amount").fill("123.00");
  await page.getByTestId("field-amount").blur();

  await expect(page.getByTestId("party-roles-flagged")).toHaveCount(0);

  await page.reload();
  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "supplier-invoice.pdf" })
    .click();

  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Dodávateľ s.r.o.");
  await expect(page.getByTestId("field-customer-name")).toHaveValue("Beta s.r.o.");
  await expect(page.getByTestId("field-customer-ico")).toHaveValue("31333532");
  await expect(page.getByTestId("party-roles-flagged")).toHaveCount(0);
});
