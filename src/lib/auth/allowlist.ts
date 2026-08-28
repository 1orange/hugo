/**
 * Normalises and validates the email allowlist from configuration.
 */

export function parseAllowlist(raw: string): string[] {
  const emails = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    throw new Error("ALLOWED_EMAILS must contain at least one email address");
  }

  return emails;
}

export function isEmailAllowed(
  email: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  if (!email) {
    return false;
  }

  return allowlist.includes(email.trim().toLowerCase());
}

export function loadAllowlistFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.ALLOWED_EMAILS;
  if (!raw) {
    throw new Error("ALLOWED_EMAILS environment variable is required");
  }

  return parseAllowlist(raw);
}
