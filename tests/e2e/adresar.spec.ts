import { test, expect } from "@playwright/test";
import { resetE2eData } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

test("the directory is searched by name, former name and IČO, and a correction is kept and logged", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill("allowed@example.com");
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);

  await page.getByTestId("nav-adresar").click();
  await expect(page).toHaveURL(/\/adresar$/);
  const row = page.getByTestId(/^directory-row-/).filter({ hasText: "Gamma Trade, s.r.o." });
  await expect(row).toHaveCount(1);

  // Search finds it by a former name, ignoring case and diacritics, and by its IČO with spaces.
  await page.getByTestId("directory-search").fill("GAMMA S.R.O.");
  await page.getByTestId("directory-search-submit").click();
  await expect(page).toHaveURL(/q=GAMMA/);
  await expect(page.getByTestId("directory-count")).toHaveText("1 subjekt zodpovedá hľadaniu.");

  await page.getByTestId("directory-search").fill("35 757 442");
  await page.getByTestId("directory-search-submit").click();
  await expect(page.getByTestId("directory-count")).toHaveText("1 subjekt zodpovedá hľadaniu.");

  await page.getByTestId("directory-search").fill("nikde-taky");
  await page.getByTestId("directory-search-submit").click();
  await expect(page.getByTestId("directory-count")).toHaveText("Nič sa nenašlo.");

  // The subject's page: its DIČ comes from the register; she corrects it, and the change is marked manual.
  await page.getByTestId("directory-search").fill("gamma");
  await page.getByTestId("directory-search-submit").click();
  await page.locator('[data-testid^="directory-link-"]').first().click();
  await expect(page.getByTestId("subject-state-dic")).toHaveText("overené");
  // The form is a client component: typed into before it hydrates, the value is lost.
  await page.waitForLoadState("networkidle");

  await page.getByTestId("subject-field-input-dic").fill("2020357599");
  await expect(page.getByTestId("subject-field-input-dic")).toHaveValue("2020357599");
  await page.getByTestId("subject-correct-submit").click();
  await expect(page.getByTestId("subject-correct-saved")).toHaveText("Úprava uložená.");
  await expect(page.getByTestId("subject-state-dic")).toHaveText("upravené ručne");

  // The correction is in the activity log.
  await page.goto("/activity");
  // The entry, not the option of the same name in the type filter.
  const entries = page.getByTestId("activity-entry");
  await expect(entries.filter({ hasText: "Subjekt v adresári opravený" }).first()).toBeVisible();
  await expect(entries.filter({ hasText: "DIČ: „2020357574“ → „2020357599“" }).first()).toBeVisible();
});
