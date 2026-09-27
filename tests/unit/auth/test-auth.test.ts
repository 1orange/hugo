import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestAuthEnabled } from "../../../src/lib/auth/test-auth.ts";

// Next.js declares NODE_ENV as always present; these cases leave it out on purpose.
function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

test("isTestAuthEnabled is off unless explicitly set to the string true", () => {
  assert.equal(isTestAuthEnabled(env({})), false);
  assert.equal(isTestAuthEnabled(env({ E2E_TEST_AUTH: "false" })), false);
  assert.equal(isTestAuthEnabled(env({ E2E_TEST_AUTH: "1" })), false);
  assert.equal(isTestAuthEnabled(env({ E2E_TEST_AUTH: "TRUE" })), false);
});

test("isTestAuthEnabled allows the bypass outside production", () => {
  assert.equal(isTestAuthEnabled(env({ E2E_TEST_AUTH: "true" })), true);
  assert.equal(
    isTestAuthEnabled(env({ E2E_TEST_AUTH: "true", NODE_ENV: "development" })),
    true,
  );
  assert.equal(
    isTestAuthEnabled(env({ E2E_TEST_AUTH: "true", NODE_ENV: "test" })),
    true,
  );
});

test("isTestAuthEnabled refuses to permit the bypass in production", () => {
  assert.throws(
    () => isTestAuthEnabled(env({ E2E_TEST_AUTH: "true", NODE_ENV: "production" })),
    /must never be enabled in production/,
  );
});

test("production without the flag is unaffected", () => {
  assert.equal(isTestAuthEnabled(env({ NODE_ENV: "production" })), false);
});
