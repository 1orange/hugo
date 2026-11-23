import { test, expect, type Browser, type Page } from "@playwright/test";
import { resetE2eData } from "./helpers";

/**
 * The fixture's sharing (ADR 0023): Beta (company 1) and Gamma (company 2) are
 * shared with the first person only; Zeta (company 3) only with a group, which
 * nobody can be seen through. The second person is allowlisted but sees no company.
 */
const SHARED = "allowed@example.com";
const OTHER = "other@example.com";

test.beforeEach(async ({ request }) => {
  await resetE2eData(request);
});

/** Each person signs in from their own browser context, so the sessions do not share cookies. */
async function signedInAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByTestId("e2e-email").fill(email);
  await page.getByTestId("e2e-submit").click();
  await expect(page).toHaveURL(/\/companies$/);
  return page;
}

test("each person sees only the companies shared with them on Firmy, and the summary counts only those", async ({
  browser,
}) => {
  const shared = await signedInAs(browser, SHARED);
  // Beta and Gamma have no profile; Zeta (group only) is invisible here, so it does not count.
  await expect(shared.getByTestId("company-1")).toHaveText("Beta s.r.o.");
  await expect(shared.getByTestId("company-2")).toHaveText("Gamma s.r.o.");
  await expect(shared.getByTestId("company-3")).toHaveCount(0);
  await expect(shared.getByTestId("summary-profile-missing")).toHaveText("2");
  await expect(shared.getByRole("button", { name: "Moje firmy" })).toHaveCount(0);

  const other = await signedInAs(browser, OTHER);
  await expect(other.getByTestId("companies-no-access")).toContainText(
    "Nemáš prístup k žiadnej firme v Drive — požiadaj o zdieľanie priečinka klienta.",
  );
  await expect(other.getByTestId("company-1")).toHaveCount(0);
  await expect(other.getByTestId("company-2")).toHaveCount(0);
  await expect(other.getByTestId("company-3")).toHaveCount(0);
  await expect(other.getByTestId("company-summary")).toHaveCount(0);
});

test("a company another person cannot see answers not found on its month, profile, structure and activity pages", async ({
  browser,
}) => {
  const other = await signedInAs(browser, OTHER);

  for (const path of ["/companies/1/2026_01", "/companies/1/profile", "/companies/1/structure", "/companies/1/activity", "/companies/2/2025_12"]) {
    const response = await other.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("a company the person can see still opens, and a company shared only with a group does not open for anyone", async ({
  browser,
}) => {
  const shared = await signedInAs(browser, SHARED);

  const beta = await shared.goto("/companies/1/2026_01");
  expect(beta?.status()).toBe(200);
  await expect(shared).toHaveURL(/\/companies\/1\/2026_01$/);

  const gamma = await shared.goto("/companies/2/2026_01");
  expect(gamma?.status()).toBe(200);

  // Zeta (company 3) is shared only with a group: not found, although its folder exists.
  const epsilon = await shared.goto("/companies/3/2026_01");
  expect(epsilon?.status()).toBe(404);
});

test("the API routes refuse another person's company and file, and serve the shared ones", async ({ browser }) => {
  const shared = await signedInAs(browser, SHARED);
  const other = await signedInAs(browser, OTHER);

  const sharedFile = await shared.request.get("/api/files/e2e-doc-supplier/preview");
  expect(sharedFile.status()).toBe(200);

  const otherFile = await other.request.get("/api/files/e2e-doc-supplier/preview");
  expect(otherFile.status()).toBe(404);

  const otherSearch = await other.request.get("/api/companies/1/register-search?q=beta");
  expect(otherSearch.status()).toBe(404);
});
