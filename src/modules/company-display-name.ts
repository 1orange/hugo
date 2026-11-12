/**
 * The name a company is shown and searched under (ADR 0007, display name).
 * Every company folder in Drive is named "<prefix> <company>": "Doklady" on the
 * live drive since 2026-11-12, "Konto" before. The prefix belongs to the Drive
 * convention, not to the company, so Hugo strips it for display and for the
 * register search (ADR 0018). The stored Drive name is unchanged.
 */

const FOLDER_PREFIX = /^(?:doklady|konto)\s+/iu;

export function companyDisplayName(driveName: string): string {
  const trimmed = driveName.normalize("NFC").trim();
  const stripped = trimmed.replace(FOLDER_PREFIX, "").trim();
  return stripped.length > 0 ? stripped : trimmed;
}
