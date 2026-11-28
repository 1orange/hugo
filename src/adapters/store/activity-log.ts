import { and, desc, eq, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { events } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import {
  eventMonthKey,
  GLOBAL_EVENT_TYPES,
  type StoredActivityEvent,
} from "@/modules/activity-log";

const DEFAULT_PAGE_SIZE = 50;
// ponytail: month filter scans up to this many rows per request; older matches
// beyond the scan window are omitted until pagination widens the window.
const MONTH_FILTER_SCAN_MULTIPLIER = 10;

export type ActivityQuery = {
  eventType?: string;
  monthKey?: string | null;
  beforeId?: number;
  limit?: number;
};

export type ActivityQueryResult = {
  entries: StoredActivityEvent[];
  hasMore: boolean;
};

function hydrate(row: typeof events.$inferSelect): StoredActivityEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    companyId: row.companyId,
    actor: row.actor,
    type: row.type,
    payloadJson: row.payloadJson,
  };
}

function matchesMonthFilter(
  row: StoredActivityEvent,
  monthKey: string | null,
): boolean {
  const payload: Record<string, unknown> = JSON.parse(row.payloadJson);
  const derived = eventMonthKey(row.type, payload);
  return derived === monthKey;
}

function applyMonthFilter(
  rows: StoredActivityEvent[],
  monthKey: string | null | undefined,
): StoredActivityEvent[] {
  if (monthKey === undefined) {
    return rows;
  }
  return rows.filter((row) => matchesMonthFilter(row, monthKey));
}

async function queryRows(whereClause: SQL | undefined, query: ActivityQuery): Promise<ActivityQueryResult> {
  const db = getDb();
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  const scanLimit =
    query.monthKey === undefined
      ? limit + 1
      : limit * MONTH_FILTER_SCAN_MULTIPLIER + 1;

  const conditions = [whereClause];
  if (query.eventType) {
    conditions.push(eq(events.type, query.eventType));
  }
  if (query.beforeId) {
    conditions.push(lt(events.id, query.beforeId));
  }

  const fetched = (
    await db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.id))
      .limit(scanLimit)
  ).map(hydrate);

  const filtered = applyMonthFilter(fetched, query.monthKey);
  const entries = filtered.slice(0, limit);
  const hasMore =
    filtered.length > limit ||
    (query.monthKey === undefined && fetched.length > limit);

  return { entries, hasMore };
}

export async function listCompanyActivity(
  companyId: number,
  query: ActivityQuery,
): Promise<ActivityQueryResult> {
  return queryRows(eq(events.companyId, companyId), query);
}

/**
 * The office-wide feed for one viewer (ADR 0023): the office's own events, which
 * are company-less and of the office vocabulary (settings, the Adresár), plus the
 * events of the companies she may see. Another company's events are not read.
 *
 * Company-less file events (a sweep that could not place a file) are left out:
 * their names belong to a company nobody can be shown.
 */
export async function listVisibleActivity(
  visibleCompanyIds: readonly number[],
  query: ActivityQuery,
): Promise<ActivityQueryResult> {
  const office = and(isNull(events.companyId), inArray(events.type, [...GLOBAL_EVENT_TYPES]));
  return queryRows(or(office, inArray(events.companyId, [...visibleCompanyIds])), query);
}

export async function listDistinctMonthKeysForCompany(companyId: number): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ payloadJson: events.payloadJson, type: events.type })
    .from(events)
    .where(eq(events.companyId, companyId));

  const keys = new Set<string>();
  for (const row of rows) {
    const payload: Record<string, unknown> = JSON.parse(row.payloadJson);
    const monthKey = eventMonthKey(row.type, payload);
    if (monthKey) {
      keys.add(monthKey);
    }
  }

  return [...keys].sort((left, right) => right.localeCompare(left));
}
