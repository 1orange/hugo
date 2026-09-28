import { test, expect } from "@playwright/test";
import { documentRow, resetE2eData, setUpCompanyOneProfile } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

test("invoice with both parties persists and matches company profile", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await setUpCompanyOneProfile(page);

  await page.goto("/companies/1/2026_01");
  await documentRow(page, "e2e-doc-supplier")
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
  await documentRow(page, "e2e-doc-supplier")
    .click();

  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Dodávateľ s.r.o.");
  await expect(page.getByTestId("field-customer-name")).toHaveValue("Beta s.r.o.");
  await expect(page.getByTestId("field-customer-ico")).toHaveValue("31333532");
  await expect(page.getByTestId("party-roles-flagged")).toHaveCount(0);
});
