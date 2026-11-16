import { test, expect } from "@playwright/test";
import { resetE2eData } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

test("assigning companies to Moje firmy narrows the table and recounts the summary", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  // Both seeded companies lack a profile, so the office-wide figure is two.
  await expect(page.getByTestId("summary-profile-missing")).toHaveText("2");
  await expect(page.getByTestId("scope-mine")).toBeEnabled();

  await page.getByTestId("assign-company-1").click();
  await expect(page.getByTestId("assign-company-1")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("scope-mine").click();
  await expect(page.getByTestId("company-1")).toHaveText("Beta s.r.o.");
  await expect(page.getByTestId("company-2")).toHaveCount(0);
  await expect(page.getByTestId("hidden-count")).toContainText("Skryté: 1 firma");
  await expect(page.getByTestId("summary-profile-missing")).toHaveText("1");

  // The second company is assigned from the full list, then both are counted.
  await page.getByTestId("scope-all").click();
  await page.getByTestId("assign-company-2").click();
  await page.getByTestId("scope-mine").click();
  await expect(page.getByTestId("company-2")).toHaveText("Gamma s.r.o.");
  await expect(page.getByTestId("hidden-count")).toHaveCount(0);
  await expect(page.getByTestId("summary-profile-missing")).toHaveText("2");

  // The choice and the assignments survive a reload.
  await page.reload();
  await expect(page.getByTestId("scope-mine")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("company-1")).toBeVisible();
  await expect(page.getByTestId("company-2")).toBeVisible();
});
