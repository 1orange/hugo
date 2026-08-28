import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEmailAllowed,
  parseAllowlist,
} from "../../../src/lib/auth/allowlist.ts";

test("parseAllowlist splits comma-separated emails and normalises case", () => {
  const list = parseAllowlist("Alice@Example.com, bob@example.com ,");
  assert.deepEqual(list, ["alice@example.com", "bob@example.com"]);
});

test("parseAllowlist rejects empty configuration", () => {
  assert.throws(() => parseAllowlist(""), /ALLOWED_EMAILS/);
  assert.throws(() => parseAllowlist("  ,  "), /ALLOWED_EMAILS/);
});

test("isEmailAllowed returns true only for allowlisted addresses", () => {
  const allowlist = ["accountant@firm.sk"];
  assert.equal(isEmailAllowed("accountant@firm.sk", allowlist), true);
  assert.equal(isEmailAllowed("Accountant@Firm.SK", allowlist), true);
  assert.equal(isEmailAllowed("stranger@example.com", allowlist), false);
  assert.equal(isEmailAllowed(undefined, allowlist), false);
  assert.equal(isEmailAllowed(null, allowlist), false);
});
