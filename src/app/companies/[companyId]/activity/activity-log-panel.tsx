import Link from "next/link";
import type { ActivityLogView } from "@/lib/activity-log/view";

type ActivityLogPanelProps = {
  view: ActivityLogView;
  basePath: string;
};

function buildHref(
  basePath: string,
  filters: ActivityLogView["filters"],
  beforeId?: number,
): string {
  const params = new URLSearchParams();
  if (filters.eventType) {
    params.set("type", filters.eventType);
  }
  if (filters.monthKey !== undefined) {
    params.set("month", filters.monthKey ?? "__none__");
  }
  if (beforeId) {
    params.set("before", String(beforeId));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function ActivityLogPanel({ view, basePath }: ActivityLogPanelProps) {
  const selectedMonth =
    view.filters.monthKey === null
      ? "__none__"
      : (view.filters.monthKey ?? "");

  return (
    <div className="flex flex-col gap-6" data-testid="activity-log">
      <form className="flex flex-wrap gap-3" method="get" action={basePath}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Event type</span>
          <select
            className="rounded-md border border-border bg-background px-3 py-2"
            name="type"
            defaultValue={view.filters.eventType ?? ""}
            data-testid="activity-type-filter"
          >
            <option value="">All types</option>
            {view.eventTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {view.scope === "company" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Month</span>
            <select
              className="rounded-md border border-border bg-background px-3 py-2"
              name="month"
              defaultValue={selectedMonth}
              data-testid="activity-month-filter"
            >
              <option value="">All months</option>
              {view.monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            data-testid="activity-apply-filters"
          >
            Apply filters
          </button>
        </div>
      </form>

      {view.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="activity-empty">
          No activity recorded yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {view.entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border border-border p-4 text-sm"
              data-testid="activity-entry"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{entry.typeLabel}</span>
                <time className="text-muted-foreground" dateTime={entry.timestamp}>
                  {entry.timestamp}
                </time>
              </div>
              <p className="mt-1 text-muted-foreground">
                {entry.actorLabel}
                {entry.monthKey ? ` · ${entry.monthKey.replace("_", "-")}` : null}
              </p>
              <p className="mt-2">{entry.summary}</p>
            </li>
          ))}
        </ol>
      )}

      {view.hasMore && view.oldestId ? (
        <Link
          className="inline-flex h-10 w-fit items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          href={buildHref(basePath, view.filters, view.oldestId)}
          data-testid="activity-load-older"
        >
          Load older
        </Link>
      ) : null}
    </div>
  );
}
