import { test, expect } from "@playwright/test";

test("document screen: filter, confirm, dismiss and persist", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.getByTestId("company-1").click();
  await expect(page).toHaveURL(/\/companies\/1\/2026_01$/);

  await expect(page.getByTestId("document-panel")).toBeVisible();
  await expect(page.getByTestId("remaining-count")).toContainText("awaiting");

  await page.goto(
    "/companies/1/2026_01?folder=" +
      encodeURIComponent("06 Iné doklady"),
  );
  await expect(
    page.getByTestId("month-document-row").filter({ hasText: "receipt-photo.jpg" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("month-document-row").filter({ hasText: "supplier-invoice.pdf" }),
  ).toHaveCount(0);

  await page.goto("/companies/1/2026_01");

  await page.getByTestId("document-confirm-e2e-doc-supplier").click();
  await expect
    .poll(async () => page.getByTestId("remaining-count").textContent(), {
      timeout: 15_000,
    })
    .toMatch(/3 documents awaiting/);

  await page.getByTestId("document-dismiss-e2e-doc-photo-heic").click();
  await expect
    .poll(async () => page.getByTestId("remaining-count").textContent(), {
      timeout: 15_000,
    })
    .toMatch(/2 documents awaiting/);

  await page.reload();
  await expect(page.getByTestId("document-confirm-e2e-doc-supplier")).toBeChecked();
  await expect(
    page.getByTestId("month-document-row").filter({ hasText: "IMG_3475.HEIC" }),
  ).toContainText("Not relevant");
});

test("document preview shows PDF and HEIC", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.goto("/companies/1/2026_01");
  await expect(page.getByTestId("document-panel")).toBeVisible();
  await expect(
    page.getByTestId("month-document-row").filter({ hasText: "supplier-invoice.pdf" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /supplier-invoice\.pdf/i }).click();
  await expect(page.locator('[data-testid="preview-pane"] iframe')).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "IMG_3475.HEIC" }).click();
  await expect(page.getByTestId("image-preview")).toBeVisible();
});
