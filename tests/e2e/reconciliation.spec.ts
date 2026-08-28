import { test, expect } from "@playwright/test";

test("reconciliation: pair, tick, remaining count falls and persists", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.getByTestId("company-1").click();
  await expect(page).toHaveURL(/\/companies\/1\/2026_01\/reconcile$/);

  await expect(page.getByTestId("reconciliation-panel")).toBeVisible();
  await expect(page.getByTestId("remaining-count")).toContainText("unticked");

  const bankPayment = page
    .getByTestId("reconciliation-payment")
    .filter({ hasText: "42.00 EUR" })
    .first();
  await expect(bankPayment).toBeVisible();

  await bankPayment.getByRole("button").first().click();
  await expect(
    page.getByTestId("unpaired-proof-warning").filter({ hasText: "supplier-invoice.pdf" }),
  ).toHaveCount(0);

  const supplierProof = page
    .getByTestId("reconciliation-proof")
    .filter({ hasText: "receipt-photo.jpg" })
    .first();
  await supplierProof.getByRole("button", { name: "Pair with selected payment" }).click();
  await expect
    .poll(async () => {
      await page.reload();
      return page
        .getByTestId("unpaired-proof-warning")
        .filter({ hasText: "receipt-photo.jpg" })
        .count();
    })
    .toBe(0);

  const beforeTick = await page.getByTestId("remaining-count").textContent();
  const cashPayment = page
    .getByTestId("reconciliation-payment")
    .filter({ hasText: "cash-receipt.pdf" })
    .first();
  await cashPayment.getByTestId("payment-tick-2").click();

  await expect
    .poll(async () => page.getByTestId("remaining-count").textContent())
    .not.toBe(beforeTick);

  const afterTick = await page.getByTestId("remaining-count").textContent();
  await page.reload();
  await expect(page.getByTestId("remaining-count")).toHaveText(afterTick!);
  await expect(page.getByTestId("payment-tick-2")).toBeChecked();
});

test("reconciliation preview shows PDF and HEIC", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.goto("/companies/1/2026_01/reconcile");
  await expect(page.getByTestId("reconciliation-panel")).toBeVisible();
  await expect(
    page.getByTestId("reconciliation-proof").filter({ hasText: "supplier-invoice.pdf" }),
  ).toBeVisible({ timeout: 10_000 });

  await page
    .getByRole("button", { name: "supplier-invoice.pdf" })
    .click();
  await expect(page.locator('[data-testid="preview-pane"] iframe')).toBeVisible({
    timeout: 10_000,
  });

  // The fake Drive client serves placeholder bytes, so the conversion itself
  // cannot succeed here; what this asserts is that HEIC is routed to the image
  // preview rather than to a "not supported" message.
  await page.getByRole("button", { name: "IMG_3475.HEIC" }).click();
  await expect(page.getByTestId("image-preview")).toBeVisible();
});
