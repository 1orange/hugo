import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * Every test starts from the seed. The specs share one database and one
 * server, so without this a spec saw what earlier ones left behind.
 */
export async function resetE2eData(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/e2e/reset");
  expect(response.ok(), `e2e reset failed: ${response.status()}`).toBeTruthy();
}

/**
 * A document's row in the workbench, by document ID. Its visible label changes
 * from the file name to the supplier once extraction reads the document.
 */
export function documentRow(page: Page, documentId: string): Locator {
  return page.locator(
    `[data-testid="month-document-row"][data-document-id="${documentId}"]`,
  );
}

/**
 * Sets company 1's profile from the fake register. Picking a candidate reloads
 * the form and fills it from RÚZ, so wait for that before typing the IČ DPH.
 */
export async function setUpCompanyOneProfile(page: Page): Promise<void> {
  await page.getByTestId("company-profile-setup-1").click();
  await page.getByTestId("profile-candidate-31333532").click();
  await expect(page).toHaveURL(/ico=31333532/);
  await expect(page.getByTestId("profile-dic")).toHaveValue("2020311335", {
    timeout: 15_000,
  });
  await page.getByTestId("profile-ic-dph").fill("SK7120001713");
  await page.getByTestId("profile-save").click();
  await expect(page).toHaveURL(/saved=1/, { timeout: 15_000 });
}
