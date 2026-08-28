import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { events } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import {
  eventMonthKey,
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

function queryRows(
  whereClause: ReturnType<typeof and> | ReturnType<typeof eq> | ReturnType<typeof isNull>,
  query: ActivityQuery,
): ActivityQueryResult {
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

  const fetched = db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.id))
    .limit(scanLimit)
    .all()
    .map(hydrate);

  const filtered = applyMonthFilter(fetched, query.monthKey);
  const entries = filtered.slice(0, limit);
  const hasMore =
    filtered.length > limit ||
    (query.monthKey === undefined && fetched.length > limit);

  return { entries, hasMore };
}

export function listCompanyActivity(
  companyId: number,
  query: ActivityQuery,
): ActivityQueryResult {
  return queryRows(eq(events.companyId, companyId), query);
}

export function listGlobalActivity(query: ActivityQuery): ActivityQueryResult {
  return queryRows(isNull(events.companyId), query);
}

export function listDistinctMonthKeysForCompany(companyId: number): string[] {
  const db = getDb();
  const rows = db
    .select({ payloadJson: events.payloadJson, type: events.type })
    .from(events)
    .where(eq(events.companyId, companyId))
    .all();

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
