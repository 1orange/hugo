import { test, expect } from "@playwright/test";
import { E2E_RESOLVABLE_EKASA_UID } from "../../src/adapters/ekasa-lookup/e2e-fake-ekasa-lookup.ts";

test("UID box loads receipt from fake lookup and persists", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.goto("/companies/1/2026_01");
  await expect(page.getByTestId("document-panel")).toBeVisible();

  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "blank-receipt.pdf" })
    .click();

  await expect(page.getByTestId("ekasa-uid-box")).toBeVisible();
  await page.getByTestId("ekasa-uid-input").fill("O-TOOSHORT");
  await page.getByTestId("ekasa-uid-submit").click();
  await expect(page.getByTestId("ekasa-uid-validation-error")).toContainText(
    /32 hexadecimálnymi/,
  );

  await page.getByTestId("ekasa-uid-input").fill(E2E_RESOLVABLE_EKASA_UID);
  await page.getByTestId("ekasa-uid-submit").click();

  await expect(page.getByTestId("extraction-source-badge")).toContainText(
    "Finančná správa",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("field-supplier-name")).toHaveValue(
    /Test Retail/,
  );
  await expect(page.getByTestId("field-amount")).toHaveValue("16.85");

  await page.reload();
  await expect(page.getByTestId("document-panel")).toBeVisible({ timeout: 15_000 });
  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "Test Retail" })
    .click({ timeout: 15_000 });
  await expect(page.getByTestId("ekasa-uid-box")).toHaveCount(0);
  await expect(page.getByTestId("field-amount")).toHaveValue("16.85");
});
