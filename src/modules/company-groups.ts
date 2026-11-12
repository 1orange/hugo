/**
 * The accountant groups on *Firmy* (2026-11-12): the shared drive keeps each
 * accountant's clients in her own folder ("Eva – doklady klientov"), and the
 * company list can be narrowed to one of them. Like *Moje firmy*, the choice is
 * a personal view kept in this browser's storage under the signed-in email.
 */

const KEY_PREFIX = "hugo.companyGroup.v1.";
const ARCHIVE = /^archív$/iu;

export function companyGroupKey(email: string): string {
  return `${KEY_PREFIX}${email.trim().toLowerCase()}`;
}

/** The groups the companies are in, accountants alphabetically, the archive last. */
export function companyGroupsOf(rows: ReadonlyArray<{ groupName: string | null }>): string[] {
  const groups = [...new Set(rows.map((row) => row.groupName).filter((group): group is string => Boolean(group)))];
  return groups.sort((left, right) => {
    const archived = Number(ARCHIVE.test(left)) - Number(ARCHIVE.test(right));
    return archived || left.localeCompare(right, "sk");
  });
}

/** The stored choice, if it is still one of the groups; otherwise every group (null). */
export function parseCompanyGroup(raw: string | null, groups: readonly string[]): string | null {
  return raw !== null && groups.includes(raw) ? raw : null;
}

/** The companies of one group; every company when no group is chosen. */
export function filterByGroup<Row extends { groupName: string | null }>(rows: readonly Row[], group: string | null): Row[] {
  return group === null ? [...rows] : rows.filter((row) => row.groupName === group);
}
