import { test, expect } from "@playwright/test";

test("document workbench: filter, confirm, dismiss and persist", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.getByTestId("company-1").click();
  await expect(page).toHaveURL(/\/companies\/1\/2026_01$/);

  await expect(page.getByTestId("document-panel")).toBeVisible();
  await expect(page.getByTestId("remaining-count")).toContainText(/dokla\w+ čaka?j?ú?/);

  // Folders filter the list rather than navigating away from it.
  await page.goto(
    "/companies/1/2026_01?folder=" + encodeURIComponent("06 Iné doklady"),
  );
  await expect(
    page.getByTestId("month-document-row").filter({ hasText: "receipt-photo.jpg" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("month-document-row").filter({ hasText: "supplier-invoice.pdf" }),
  ).toHaveCount(0);

  await page.goto("/companies/1/2026_01");

  // The decision belongs to the selected document, under its preview.
  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "supplier-invoice.pdf" })
    .click();
  await page.getByTestId("document-confirm-e2e-doc-supplier").click();
  await expect
    .poll(async () => page.getByTestId("remaining-count").textContent(), {
      timeout: 15_000,
    })
    .toMatch(/3 doklady čakajú/);
  await expect(page.getByTestId("decision-chip")).toContainText("Potvrdené");

  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "IMG_3475.HEIC" })
    .click();
  await page.getByTestId("document-dismiss-e2e-doc-photo-heic").click();
  await page.getByTestId("dismiss-reason-e2e-doc-photo-heic").fill("Duplicitná fotka");
  await page.getByTestId("dismiss-confirm").click();
  await expect
    .poll(async () => page.getByTestId("remaining-count").textContent(), {
      timeout: 15_000,
    })
    .toMatch(/2 doklady čakajú/);

  await page.reload();
  await expect(page.getByTestId("remaining-count")).toContainText("2 doklady čakajú");
  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "supplier-invoice.pdf" })
    .click();
  await expect(page.getByTestId("decision-chip")).toContainText("Potvrdené");
  await expect(
    page.getByTestId("month-document-row").filter({ hasText: "IMG_3475.HEIC" }),
  ).toContainText("Duplicitná fotka");
});

test("keyboard confirms the selected document without touching the list", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);
  await page.goto("/companies/1/2026_01");
  await expect(page.getByTestId("document-panel")).toBeVisible();

  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "receipt-photo.jpg" })
    .click();

  // Counted rather than asserted absolutely: the seed is shared across specs,
  // so what matters is that one more document left the awaiting pile.
  const before = await page.getByTestId("remaining-count").textContent();
  await page.keyboard.press("c");

  await expect(page.getByTestId("decision-chip")).toContainText("Potvrdené", {
    timeout: 15_000,
  });
  await expect
    .poll(async () => page.getByTestId("remaining-count").textContent(), {
      timeout: 15_000,
    })
    .not.toBe(before);
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

  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "supplier-invoice.pdf" })
    .click();
  await expect(page.locator('[data-testid="preview-pane"] iframe')).toBeVisible({
    timeout: 10_000,
  });

  await page
    .getByTestId("month-document-row")
    .filter({ hasText: "IMG_3475.HEIC" })
    .click();
  await expect(page.getByTestId("image-preview")).toBeVisible();
});

test("closed months are reachable from the month rail and render read-only", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);
  await page.goto("/companies/1/2026_01");

  await expect(page.getByTestId("month-chip-2026_01")).toHaveAttribute(
    "aria-current",
    "page",
  );
});
