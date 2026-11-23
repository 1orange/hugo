/**
 * The landing screen answers two questions at once: whom to chase, and where to
 * start working. Both come from *presence* — what arrived and when — never from
 * a model of what should have arrived (PRD 0001, slice 21).
 *
 * The state is derived rather than stored: nothing here is a column, so a file
 * landing in Drive changes the row on the next sweep with no write.
 */

export type ChaseState =
  /** Nothing at all has arrived this month. The loudest row. */
  | "silent"
  /** Something arrived, but no bank statement yet. */
  | "no-statement"
  /** The statement arrived and no proofs did. */
  | "no-proofs"
  /** Everything needed is here and documents await her decision. */
  | "decide"
  /** Every document has a decision; the month can be filed and closed. */
  | "ready-to-close"
  /** The month is closed. Read-only, and nothing about it is her move. */
  | "closed"
  /** No open month at all. A former or dormant client, not work. */
  | "idle"
  /** A specific month was asked for and this company has no folder for it. */
  | "no-month";

export type ChaseInput = {
  /** The month being looked at: the company's open month, or one she picked. */
  monthKey: string | null;
  /** True when she asked for a specific month rather than "each open month". */
  monthRequested: boolean;
  monthClosed: boolean;
  statementArrivedAt: string | null;
  proofsArrived: number;
  awaitingCount: number | null;
  lastUploadAt: string | null;
  /** A client in the archive group. */
  archived?: boolean;
};

/**
 * Order matters and is a priority, not a sequence: a client who has sent
 * nothing outranks one who is merely missing a statement, because the first
 * needs a phone call and the second needs a reminder.
 */
export function deriveChaseState(input: ChaseInput): ChaseState {
  // An archived client gets no new months: nothing to chase (the office's rules, 2026-11-11).
  if (input.archived) {
    return "idle";
  }
  if (!input.monthKey) {
    return input.monthRequested ? "no-month" : "idle";
  }
  // A closed month is read-only, so nothing in it is an action for her —
  // including documents she closed the month without deciding.
  if (input.monthClosed) {
    return "closed";
  }
  if (!input.lastUploadAt) {
    return "silent";
  }
  if (!input.statementArrivedAt) {
    return "no-statement";
  }
  if (input.proofsArrived === 0) {
    return "no-proofs";
  }
  if ((input.awaitingCount ?? 0) > 0) {
    return "decide";
  }
  return "ready-to-close";
}

const RANK: Record<ChaseState, number> = {
  silent: 0,
  "no-statement": 1,
  "no-proofs": 2,
  decide: 3,
  "ready-to-close": 4,
  closed: 5,
  idle: 6,
  "no-month": 7,
};

export function chaseSortRank(state: ChaseState): number {
  return RANK[state];
}

/** Severity drives the row stripe. `none` is a row that needs no attention. */
export type ChaseSeverity = "critical" | "warning" | "active" | "done" | "none";

const SEVERITY: Record<ChaseState, ChaseSeverity> = {
  silent: "critical",
  "no-statement": "warning",
  "no-proofs": "warning",
  decide: "active",
  "ready-to-close": "done",
  closed: "none",
  idle: "none",
  "no-month": "none",
};

export function chaseSeverity(state: ChaseState): ChaseSeverity {
  return SEVERITY[state];
}

/** A row with nothing to act on is drawn back rather than shouting in colour. */
export function chaseIsQuiet(state: ChaseState): boolean {
  return state === "idle" || state === "no-month" || state === "closed";
}

/**
 * The plain-language next step, in her words. Deliberately a verb and a number
 * rather than a lifecycle stage name — a stage makes her translate before she
 * can act.
 */
export function chaseActionLabel(
  state: ChaseState,
  awaitingCount: number | null,
): string {
  switch (state) {
    case "idle":
      return "Nečinná — žiadny otvorený mesiac";
    case "no-month":
      return "Tento mesiac tu nie je";
    case "closed":
      return "Uzavretý";
    case "silent":
      return "Urgovať — priečinok je prázdny";
    case "no-statement":
      return "Vypýtať bankový výpis";
    case "no-proofs":
      return "Vypýtať doklady";
    case "decide":
      return `Rozhodnúť ${awaitingCount ?? 0}`;
    case "ready-to-close":
      return "Pripravené na uzavretie";
  }
}

export type ChaseRowLike = { chaseState: ChaseState; name: string };

/** Sort the clients who owe her something to the top, then alphabetically. */
export function sortChaseRows<T extends ChaseRowLike>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const byRank = chaseSortRank(left.chaseState) - chaseSortRank(right.chaseState);
    if (byRank !== 0) {
      return byRank;
    }
    return left.name.localeCompare(right.name, "sk");
  });
}

/** The fields the summary strip counts. `CompanyListItem` satisfies it. */
export type ChaseSummaryRow = {
  monthKey: string | null;
  monthClosed: boolean;
  statementArrivedAt: string | null;
  chaseState: ChaseState;
  awaitingCount: number | null;
  profileMissing: boolean;
  structureDeviations: number;
};

export type ChaseSummary = {
  awaitingTotal: number;
  withoutStatement: number;
  silent: number;
  readyToClose: number;
  withoutProfile: number;
  /** Companies with at least one structure deviation. */
  withStructureDeviations: number;
};

/**
 * Figures for the summary strip. Pure so the client can recount the rows it is
 * showing after the group filter, rather than trusting a server total.
 */
export function summariseChaseList(
  companies: readonly ChaseSummaryRow[],
): ChaseSummary {
  return {
    awaitingTotal: companies.reduce(
      (total, company) => total + (company.awaitingCount ?? 0),
      0,
    ),
    withoutStatement: companies.filter(
      (company) =>
        company.monthKey !== null &&
        !company.monthClosed &&
        company.statementArrivedAt === null,
    ).length,
    silent: companies.filter((company) => company.chaseState === "silent").length,
    readyToClose: companies.filter(
      (company) => company.chaseState === "ready-to-close",
    ).length,
    withoutProfile: companies.filter((company) => company.profileMissing).length,
    withStructureDeviations: companies.filter(
      (company) => company.structureDeviations > 0,
    ).length,
  };
}

/** The summary figures she can filter the table by; each counts what it filters to. */
export type ChaseFilter =
  | "awaiting"
  | "without-statement"
  | "silent"
  | "ready-to-close"
  | "profile-missing"
  | "structure";

export const CHASE_FILTERS: readonly ChaseFilter[] = [
  "awaiting",
  "without-statement",
  "silent",
  "profile-missing",
  "structure",
  "ready-to-close",
];

/** Whether a company is one the figure counts: the same rule `summariseChaseList` uses. */
export function matchesChaseFilter(company: ChaseSummaryRow, filter: ChaseFilter): boolean {
  switch (filter) {
    case "awaiting":
      return (company.awaitingCount ?? 0) > 0;
    case "without-statement":
      return company.monthKey !== null && !company.monthClosed && company.statementArrivedAt === null;
    case "silent":
      return company.chaseState === "silent";
    case "ready-to-close":
      return company.chaseState === "ready-to-close";
    case "profile-missing":
      return company.profileMissing;
    case "structure":
      return company.structureDeviations > 0;
  }
}
