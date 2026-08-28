/**
 * Gate for the E2E-only credentials provider.
 *
 * That provider accepts an email with no password, so enabling it in a
 * production deployment would let anyone sign in as the allowlisted
 * accountant. The allowlist check inside the provider does not help: an
 * attacker simply types the allowlisted address. Refusing to boot is the
 * only safe response.
 */

export function isTestAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const enabled = env.E2E_TEST_AUTH === "true";

  if (enabled && env.NODE_ENV === "production") {
    throw new Error(
      "E2E_TEST_AUTH must never be enabled in production: it permits password-less sign-in as any allowlisted address",
    );
  }

  return enabled;
}
