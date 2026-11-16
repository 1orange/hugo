/**
 * *Moje firmy* (ADR 0011 amendment, 2026-11-11; PRD 0004). Which companies an
 * accountant works on is a personal filter, not a permission: the list lives in
 * this browser's local storage, under a key namespaced by the signed-in email,
 * and never reaches the server.
 *
 * Companies are identified by Drive folder id, which is stable across database
 * rebuilds. Unknown ids are kept, not pruned: a company that is briefly missing
 * from Drive simply drops out of the view and comes back with its assignment.
 *
 * Everything here is pure. Storage access, which can be blocked or throw, lives
 * in the client wrapper, so parsing never has to care where a value came from.
 */

export const ASSIGNED_COMPANIES_VERSION = 1;
const KEY_PREFIX = "hugo.assignedCompanies.v1.";

export type AssignmentMode = "mine" | "all";

export type AssignedCompanies = {
  version: typeof ASSIGNED_COMPANIES_VERSION;
  mode: AssignmentMode;
  /** Drive folder ids, in the order they were assigned. */
  companies: string[];
};

export function assignedCompaniesKey(email: string): string {
  return `${KEY_PREFIX}${email.trim().toLowerCase()}`;
}

/** The office as a whole, with nothing assigned. Also what corrupt storage recovers to. */
export function defaultAssignedCompanies(): AssignedCompanies {
  return { version: ASSIGNED_COMPANIES_VERSION, mode: "all", companies: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Never throws. A missing, unreadable, foreign, other-version or otherwise
 * malformed value becomes the default: a page must still load for someone whose
 * storage holds junk.
 */
export function parseAssignedCompanies(raw: string | null | undefined): AssignedCompanies {
  if (typeof raw !== "string") {
    return defaultAssignedCompanies();
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return defaultAssignedCompanies();
  }

  if (!isRecord(value) || value.version !== ASSIGNED_COMPANIES_VERSION) {
    return defaultAssignedCompanies();
  }
  if (value.mode !== "mine" && value.mode !== "all") {
    return defaultAssignedCompanies();
  }
  const companies = value.companies;
  if (
    !Array.isArray(companies) ||
    !companies.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return defaultAssignedCompanies();
  }

  return {
    version: ASSIGNED_COMPANIES_VERSION,
    mode: value.mode,
    companies: [...new Set(companies as string[])],
  };
}

export function serializeAssignedCompanies(state: AssignedCompanies): string {
  return JSON.stringify({
    version: ASSIGNED_COMPANIES_VERSION,
    mode: state.mode,
    companies: state.companies,
  });
}

export function isAssigned(state: AssignedCompanies, driveFolderId: string): boolean {
  return state.companies.includes(driveFolderId);
}

export function assignCompany(state: AssignedCompanies, driveFolderId: string): AssignedCompanies {
  if (isAssigned(state, driveFolderId)) {
    return state;
  }
  return { ...state, companies: [...state.companies, driveFolderId] };
}

export function unassignCompany(state: AssignedCompanies, driveFolderId: string): AssignedCompanies {
  if (!isAssigned(state, driveFolderId)) {
    return state;
  }
  return {
    ...state,
    companies: state.companies.filter((id) => id !== driveFolderId),
  };
}

export function toggleCompany(state: AssignedCompanies, driveFolderId: string): AssignedCompanies {
  return isAssigned(state, driveFolderId)
    ? unassignCompany(state, driveFolderId)
    : assignCompany(state, driveFolderId);
}

export function setMode(state: AssignedCompanies, mode: AssignmentMode): AssignedCompanies {
  return { ...state, mode };
}

/**
 * The rows the page shows. `all` shows everything; `mine` shows the rows whose
 * Drive folder is assigned, in their original order. Ids with no row are ignored.
 */
export function filterCompanies<T extends { driveFolderId: string }>(
  rows: readonly T[],
  state: AssignedCompanies,
): T[] {
  if (state.mode === "all") {
    return [...rows];
  }
  const assigned = new Set(state.companies);
  return rows.filter((row) => assigned.has(row.driveFolderId));
}

/** How many companies the filter is hiding right now. Zero when showing all. */
export function hiddenCount<T extends { driveFolderId: string }>(
  rows: readonly T[],
  state: AssignedCompanies,
): number {
  return rows.length - filterCompanies(rows, state).length;
}
