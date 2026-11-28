import { getCompanyById } from "@/adapters/store/companies";
import { companyDisplayName } from "@/modules/company-display-name";
import {
  listCompanyActivity,
  listDistinctMonthKeysForCompany,
  listVisibleActivity,
  type ActivityQuery,
  type ActivityQueryResult,
} from "@/adapters/store/activity-log";
import {
  ALL_EVENT_TYPES,
  COMPANY_SCOPED_EVENT_TYPES,
  EVENT_TYPE_LABELS,
  formatActivityEntry,
  type ActivityEntry,
  type KnownEventType,
} from "@/modules/activity-log";

export type ActivityLogView = {
  scope: "company" | "global";
  companyId: number | null;
  companyName: string | null;
  entries: ActivityEntry[];
  /** The display names of the companies the entries name, for the office-wide feed (by companyId). */
  companyNames: Record<number, string>;
  hasMore: boolean;
  oldestId: number | null;
  eventTypeOptions: Array<{ value: string; label: string }>;
  monthOptions: Array<{ value: string; label: string }>;
  filters: {
    eventType?: string;
    monthKey?: string | null;
  };
};

function buildTypeOptions(types: readonly KnownEventType[]) {
  return types.map((type) => ({
    value: type,
    label: EVENT_TYPE_LABELS[type],
  }));
}

function buildMonthOptions(monthKeys: string[]) {
  return [
    ...monthKeys.map((monthKey) => ({
      value: monthKey,
      label: monthKey.replace("_", "-"),
    })),
    { value: "__none__", label: "No month" },
  ];
}

function toQuery(filters: ActivityLogView["filters"], beforeId?: number): ActivityQuery {
  return {
    eventType: filters.eventType,
    monthKey:
      filters.monthKey === "__none__"
        ? null
        : filters.monthKey === undefined
          ? undefined
          : filters.monthKey,
    beforeId,
  };
}

function buildView(
  scope: ActivityLogView["scope"],
  result: ActivityQueryResult,
  options: {
    companyId: number | null;
    companyName: string | null;
    companyNames: ActivityLogView["companyNames"];
    eventTypeOptions: ActivityLogView["eventTypeOptions"];
    monthOptions: ActivityLogView["monthOptions"];
    filters: ActivityLogView["filters"];
  },
): ActivityLogView {
  const entries = result.entries.map(formatActivityEntry);
  return {
    scope,
    companyId: options.companyId,
    companyName: options.companyName,
    entries,
    companyNames: options.companyNames,
    hasMore: result.hasMore,
    oldestId: entries.length > 0 ? entries[entries.length - 1]!.id : null,
    eventTypeOptions: options.eventTypeOptions,
    monthOptions: options.monthOptions,
    filters: options.filters,
  };
}

export async function buildCompanyActivityView(
  companyId: number,
  filters: ActivityLogView["filters"] = {},
  beforeId?: number,
): Promise<ActivityLogView | null> {
  const company = await getCompanyById(companyId);
  if (!company) {
    return null;
  }

  const result = await listCompanyActivity(companyId, toQuery(filters, beforeId));
  return buildView("company", result, {
    companyId,
    companyName: companyDisplayName(company.name),
    companyNames: {},
    eventTypeOptions: buildTypeOptions(COMPANY_SCOPED_EVENT_TYPES),
    monthOptions: buildMonthOptions(await listDistinctMonthKeysForCompany(companyId)),
    filters,
  });
}

/**
 * The office-wide feed for one viewer (ADR 0023): her companies' events and the
 * office's own. `visibleCompanyIds` is the companies she may see; the store reads
 * nothing else. Each company-named entry carries its company's name, since the
 * feed mixes companies.
 */
export async function buildGlobalActivityView(
  visibleCompanyIds: readonly number[],
  filters: ActivityLogView["filters"] = {},
  beforeId?: number,
): Promise<ActivityLogView> {
  const result = await listVisibleActivity(visibleCompanyIds, toQuery(filters, beforeId));
  const companyNames: Record<number, string> = {};
  const named = [...new Set(result.entries.map((event) => event.companyId).filter((id): id is number => id !== null))];
  for (const companyId of named) {
    const company = await getCompanyById(companyId);
    if (company) {
      companyNames[companyId] = companyDisplayName(company.name);
    }
  }
  return buildView("global", result, {
    companyId: null,
    companyName: null,
    companyNames,
    eventTypeOptions: buildTypeOptions(ALL_EVENT_TYPES),
    monthOptions: [{ value: "__none__", label: "No month" }],
    filters,
  });
}
