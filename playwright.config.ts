import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "node --import tsx scripts/seed-e2e-reconciliation.ts && E2E_TEST_AUTH=true DRIVE_CLIENT=fake DRIVE_PARENT_FOLDER_ID=e2e-parent ALLOWED_EMAILS=allowed@example.com AUTH_SECRET=e2e-test-secret AUTH_GOOGLE_ID=e2e AUTH_GOOGLE_SECRET=e2e DATABASE_PATH=./data/e2e.db npm run dev -- --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
