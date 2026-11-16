import { test, expect } from "@playwright/test";
import { documentRow, resetE2eData } from "./helpers";

// Gamma's December (2025_12) is closed by the seed before its two files were first seen: a received
// invoice, which may move into the open month, and a bank statement, which belongs to its period.

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);
}

test("late arrivals are moved into the open month in one click, and a move is undone", async ({ page }) => {
  await signIn(page);

  // The closed month points to the open one.
  await page.goto("/companies/2/2025_12");
  await expect(page.getByTestId("late-arrivals-source-note")).toContainText("Po uzavretí sem prišli 2 doklady");
  await page.getByTestId("late-arrivals-source-note").getByRole("link", { name: "2026_01" }).click();
  await expect(page).toHaveURL(/\/companies\/2\/2026_01$/);

  // The open month proposes the invoice and warns about the statement.
  const panel = page.getByTestId("late-arrivals");
  await expect(panel.getByTestId("late-arrival-e2e-late-invoice")).toHaveAttribute("data-kind", "move");
  await expect(panel.getByTestId("late-arrival-warning-e2e-late-statement")).toContainText("nepresúva");
  await expect(documentRow(page, "e2e-late-invoice")).toHaveCount(0);

  await page.waitForLoadState("networkidle");
  await panel.getByTestId("late-arrivals-move-all").click();
  await expect(page.getByTestId("late-arrivals-message")).toContainText("Presunuté: 1 doklad");
  await expect(panel.getByTestId("late-arrival-e2e-late-invoice")).toHaveCount(0);
  await expect(documentRow(page, "e2e-late-invoice")).toHaveCount(1);

  // It stays moved across a reload: the move is in Drive and the next sweep agrees.
  await page.reload();
  await expect(documentRow(page, "e2e-late-invoice")).toHaveCount(1);
  await expect(page.getByTestId("late-arrival-e2e-late-invoice")).toHaveCount(0);

  // Only the statement is still waiting in December.
  await page.goto("/companies/2/2025_12");
  await expect(page.getByTestId("late-arrivals-source-note")).toContainText("Po uzavretí sem prišiel 1 doklad");

  // Undo puts the invoice back, and it is proposed again.
  await page.goto("/companies/2/2026_01");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("late-arrivals-moved").locator("summary").click();
  await page.getByTestId("late-arrival-undo-e2e-late-invoice").click();
  await expect(page.getByTestId("late-arrival-e2e-late-invoice")).toHaveAttribute("data-kind", "move");
  await expect(documentRow(page, "e2e-late-invoice")).toHaveCount(0);

  // The move and its undo are in the company's activity log.
  await page.goto("/companies/2/activity");
  const entries = page.getByTestId("activity-entry");
  await expect(entries.filter({ hasText: "Neskorý doklad „late-invoice.pdf“ presunutý z 2025_12 do 2026_01" })).toHaveCount(1);
  await expect(entries.filter({ hasText: "Vrátené: „late-invoice.pdf“ z 2026_01 späť do 2025_12" })).toHaveCount(1);
});

test("an ignored late arrival leaves the list and stays off it", async ({ page }) => {
  await signIn(page);
  await page.goto("/companies/2/2026_01");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("late-arrival-ignore-e2e-late-statement").click();
  await expect(page.getByTestId("late-arrival-e2e-late-statement")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("late-arrival-e2e-late-invoice")).toBeVisible();
  await expect(page.getByTestId("late-arrival-e2e-late-statement")).toHaveCount(0);
});
