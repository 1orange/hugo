import Link from "next/link";
import type { ActivityLogView } from "@/lib/activity-log/view";
import { formatDateTime, monthLabel } from "@/modules/format-sk";

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
          <span className="text-ink-3">Typ udalosti</span>
          <select
            className="rounded-md border border-line bg-surface-2 px-3 py-2"
            name="type"
            defaultValue={view.filters.eventType ?? ""}
            data-testid="activity-type-filter"
          >
            <option value="">Všetky typy</option>
            {view.eventTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {view.scope === "company" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-3">Mesiac</span>
            <select
              className="rounded-md border border-line bg-surface-2 px-3 py-2"
              name="month"
              defaultValue={selectedMonth}
              data-testid="activity-month-filter"
            >
              <option value="">Všetky mesiace</option>
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
            className="inline-flex h-10 items-center justify-center rounded-md border border-line-2 bg-surface px-4 text-sm font-medium hover:border-accent hover:text-accent"
            data-testid="activity-apply-filters"
          >
            Použiť filtre
          </button>
        </div>
      </form>

      {view.entries.length === 0 ? (
        <p className="text-sm text-ink-3" data-testid="activity-empty">
          Zatiaľ sa nezaznamenala žiadna aktivita.
        </p>
      ) : (
        <ol className="space-y-3">
          {view.entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border border-line bg-surface p-4 text-sm"
              data-testid="activity-entry"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{entry.typeLabel}</span>
                <time className="font-mono text-ink-3" dateTime={entry.timestamp}>
                  {formatDateTime(entry.timestamp)}
                </time>
              </div>
              <p className="mt-1 text-ink-3">
                {entry.actorLabel}
                {entry.monthKey ? ` · ${monthLabel(entry.monthKey)}` : null}
              </p>
              <p className="mt-2">{entry.summary}</p>
            </li>
          ))}
        </ol>
      )}

      {view.hasMore && view.oldestId ? (
        <Link
          className="inline-flex h-10 w-fit items-center justify-center rounded-md border border-line-2 bg-surface px-4 text-sm font-medium hover:border-accent hover:text-accent"
          href={buildHref(basePath, view.filters, view.oldestId)}
          data-testid="activity-load-older"
        >
          Načítať staršie
        </Link>
      ) : null}
    </div>
  );
}
