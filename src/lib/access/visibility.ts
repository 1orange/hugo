/**
 * Which companies a person may see (PRD 0007, ADR 0023): the companies whose
 * Drive folder is shared with their email, as Hugo last read the sharing.
 *
 * This module is the one place that answers the question. Pages, server actions,
 * API routes and the Omega export all ask here, so the rule cannot drift between
 * them. It reads the access snapshot in one query and never calls Drive. It has
 * no session of its own; the signed-in email is passed in (see ./guard.ts).
 *
 * Fail closed: a company whose sharing was never read is invisible to everyone.
 */
import { listCompanyAccessRows, type CompanyAccessRow } from "@/adapters/store/company-access";
import { canSee, type AccessPrincipal } from "@/modules/company-access";
import type { AppEvent } from "@/lib/events/bus";

export type VisibleCompanies = {
  /** The companies this email may see. */
  ids: ReadonlySet<number>;
  /** Active companies in the database. Zero means there are none at all, not that none are visible. */
  activeCount: number;
  /**
   * Whether any company's sharing has been read yet. False while Hugo is still
   * waiting for its first Drive read: the screens say so instead of "no access".
   */
  snapshotted: boolean;
};

/**
 * The visibility of every company in `rows` to one email. Pure: the rows come
 * from `listCompanyAccessRows`, and the rule is `canSee`, with no snapshot
 * giving null, which is never visible.
 */
export function visibilityOf(email: string, rows: readonly CompanyAccessRow[]): VisibleCompanies {
  const byCompany = new Map<number, { refreshedAt: string | null; principals: AccessPrincipal[] }>();
  for (const row of rows) {
    const entry = byCompany.get(row.companyId) ?? { refreshedAt: row.accessRefreshedAt, principals: [] };
    if (row.principal) {
      entry.principals.push(row.principal);
    }
    byCompany.set(row.companyId, entry);
  }

  const ids = new Set<number>();
  let snapshotted = false;
  for (const [companyId, entry] of byCompany) {
    if (entry.refreshedAt !== null) {
      snapshotted = true;
    }
    const principals = entry.refreshedAt === null ? null : entry.principals;
    if (canSee(email, principals)) {
      ids.add(companyId);
    }
  }
  return { ids, activeCount: byCompany.size, snapshotted };
}

/** Every company this email may see, in one query. */
export async function visibleCompanies(email: string): Promise<VisibleCompanies> {
  return visibilityOf(email, await listCompanyAccessRows());
}

/** Whether this email may see this one company. An inactive or unknown company is not visible. */
export async function isCompanyVisible(email: string, companyId: number): Promise<boolean> {
  return visibilityOf(email, await listCompanyAccessRows(companyId)).ids.has(companyId);
}

/** Every row a queue snapshot lists per company: the jobs and the per-month waiting counts. */
type QueueRowsLike = {
  running: Array<{ companyId: number }>;
  waiting: Array<{ companyId: number }>;
  delayed: Array<{ companyId: number }>;
  recent: Array<{ companyId: number }>;
  waitingMonths: Array<{ companyId: number }>;
};

/**
 * The queue kept to the visible companies. The queue is shared by every company,
 * so without this a person would see another client's documents and month names
 * (the jobs and `waitingMonths`). The lane concurrency, the services and the Drive
 * panel name no company and stay as they are.
 */
export function restrictQueueToCompanies<View extends QueueRowsLike>(view: View, ids: ReadonlySet<number>): View {
  const keep = <Row extends { companyId: number }>(rows: Row[]): Row[] => rows.filter((row) => ids.has(row.companyId));
  return {
    ...view,
    running: keep(view.running),
    waiting: keep(view.waiting),
    delayed: keep(view.delayed),
    recent: keep(view.recent),
    waitingMonths: keep(view.waitingMonths),
  };
}

/**
 * One live event kept to the visible companies, or null when none of it is
 * theirs. A sweep's change log can name several companies in one event; only
 * the visible ones are sent on.
 */
export function restrictEventToCompanies(event: AppEvent, ids: ReadonlySet<number>): AppEvent | null {
  switch (event.type) {
    case "document-read":
    case "document-checked":
      return ids.has(event.companyId) ? event : null;
    case "files-changed": {
      const months = event.months.filter((month) => ids.has(month.companyId));
      return months.length > 0 ? { ...event, months } : null;
    }
    case "queue-changed":
    case "services-changed":
      return event;
  }
}
