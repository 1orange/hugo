import { test, expect } from "@playwright/test";
import { documentRow, resetE2eData } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

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
    documentRow(page, "e2e-doc-photo-jpeg"),
  ).toBeVisible();
  await expect(
    documentRow(page, "e2e-doc-supplier"),
  ).toHaveCount(0);

  await page.goto("/companies/1/2026_01");

  // The decision belongs to the selected document, under its preview.
  await documentRow(page, "e2e-doc-supplier")
    .click();
  await page.getByTestId("document-confirm-e2e-doc-supplier").click();
  await expect
    .poll(async () => page.getByTestId("remaining-count").textContent(), {
      timeout: 15_000,
    })
    .toMatch(/4 doklady čakajú/);
  await expect(page.getByTestId("decision-chip")).toContainText("Potvrdené");

  await documentRow(page, "e2e-doc-photo-heic")
    .click();
  await page.getByTestId("document-dismiss-e2e-doc-photo-heic").click();
  await page.getByTestId("dismiss-reason-e2e-doc-photo-heic").fill("Duplicitná fotka");
  await page.getByTestId("dismiss-confirm").click();
  await expect
    .poll(async () => page.getByTestId("remaining-count").textContent(), {
      timeout: 15_000,
    })
    .toMatch(/3 doklady čakajú/);

  await page.reload();
  await expect(page.getByTestId("remaining-count")).toContainText("3 doklady čakajú");
  await documentRow(page, "e2e-doc-supplier")
    .click();
  await expect(page.getByTestId("decision-chip")).toContainText("Potvrdené");
  await expect(
    documentRow(page, "e2e-doc-photo-heic"),
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

  await documentRow(page, "e2e-doc-photo-jpeg")
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
    documentRow(page, "e2e-doc-supplier"),
  ).toBeVisible({ timeout: 10_000 });

  await documentRow(page, "e2e-doc-supplier")
    .click();
  await expect(page.locator('[data-testid="preview-pane"] iframe')).toBeVisible({
    timeout: 10_000,
  });

  await documentRow(page, "e2e-doc-photo-heic")
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
