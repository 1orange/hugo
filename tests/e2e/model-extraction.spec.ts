import { test, expect } from "@playwright/test";
import { documentRow, resetE2eData, setUpCompanyOneProfile } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

test("pending invoice fills from stub extractor and corrections persist", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await setUpCompanyOneProfile(page);

  await page.goto("/companies/1/2026_01");
  await documentRow(page, "e2e-doc-supplier")
    .click();

  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Dodávateľ s.r.o.", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("extraction-source-badge")).toHaveText("Model");

  await page.getByTestId("field-document-number").fill("20260999");
  await page.getByTestId("field-document-number").blur();

  await page.reload();
  await documentRow(page, "e2e-doc-supplier")
    .click();

  await expect(page.getByTestId("field-document-number")).toHaveValue("20260999");
  await expect(page.getByTestId("field-supplier-name")).toHaveValue("Dodávateľ s.r.o.");
});
