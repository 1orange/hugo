import { defineConfig, devices } from "@playwright/test";

/**
 * Needs the compose Postgres and Redis: `docker compose --env-file .env.docker
 * up -d postgres redis`. The run has its own database (hugo_e2e, created if
 * missing) and its own Redis prefix, so it never touches dev data; the worker
 * runs in the server's process (HUGO_ROLE=all), next to the fake Drive.
 */
const e2eEnv = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://hugo:hugo@127.0.0.1:5432/hugo_e2e",
  REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379",
  HUGO_REDIS_PREFIX: "hugo-e2e",
  HUGO_ROLE: "all",
  E2E_TEST_AUTH: "true",
  EXTRACTOR: "stub",
  DRIVE_CLIENT: "fake",
  COMPANY_REGISTER: "fake",
  DRIVE_PARENT_FOLDER_ID: "e2e-parent",
  ALLOWED_EMAILS: "allowed@example.com",
  AUTH_SECRET: "e2e-test-secret",
  AUTH_GOOGLE_ID: "e2e",
  AUTH_GOOGLE_SECRET: "e2e",
};

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
    command: "node --import tsx scripts/seed-e2e-reconciliation.ts && npm run dev -- --port 3000",
    env: e2eEnv,
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
