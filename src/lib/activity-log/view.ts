import { getCompanyById } from "@/adapters/store/companies";
import {
  listCompanyActivity,
  listDistinctMonthKeysForCompany,
  listGlobalActivity,
  type ActivityQuery,
  type ActivityQueryResult,
} from "@/adapters/store/activity-log";
import {
  COMPANY_SCOPED_EVENT_TYPES,
  EVENT_TYPE_LABELS,
  formatActivityEntry,
  GLOBAL_EVENT_TYPES,
  type ActivityEntry,
  type KnownEventType,
} from "@/modules/activity-log";

export type ActivityLogView = {
  scope: "company" | "global";
  companyId: number | null;
  companyName: string | null;
  entries: ActivityEntry[];
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
    hasMore: result.hasMore,
    oldestId: entries.length > 0 ? entries[entries.length - 1]!.id : null,
    eventTypeOptions: options.eventTypeOptions,
    monthOptions: options.monthOptions,
    filters: options.filters,
  };
}

export function buildCompanyActivityView(
  companyId: number,
  filters: ActivityLogView["filters"] = {},
  beforeId?: number,
): ActivityLogView | null {
  const company = getCompanyById(companyId);
  if (!company) {
    return null;
  }

  const result = listCompanyActivity(companyId, toQuery(filters, beforeId));
  return buildView("company", result, {
    companyId,
    companyName: company.name,
    eventTypeOptions: buildTypeOptions(COMPANY_SCOPED_EVENT_TYPES),
    monthOptions: buildMonthOptions(listDistinctMonthKeysForCompany(companyId)),
    filters,
  });
}

export function buildGlobalActivityView(
  filters: ActivityLogView["filters"] = {},
  beforeId?: number,
): ActivityLogView {
  const result = listGlobalActivity(toQuery(filters, beforeId));
  return buildView("global", result, {
    companyId: null,
    companyName: null,
    eventTypeOptions: buildTypeOptions(GLOBAL_EVENT_TYPES),
    monthOptions: [{ value: "__none__", label: "No month" }],
    filters,
  });
}
