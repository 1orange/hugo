"use client";

import Link from "next/link";
import { useState } from "react";
import { monthKeyYear, monthShortLabel } from "@/modules/format-sk";

type ChaseMonthPickerProps = {
  monthKeys: string[];
  selected: string | null;
};

/**
 * The default view reports each company's *own* open month, which is the daily
 * chase question. Picking a calendar month switches every row to that month, so
 * a past month can be reviewed the same way it was worked.
 */
export function ChaseMonthPicker({ monthKeys, selected }: ChaseMonthPickerProps) {
  const years = [...new Set(monthKeys.map((key) => monthKeyYear(key)))]
    .filter((year): year is number => year !== null)
    .sort((left, right) => left - right);

  const [year, setYear] = useState<number>(
    (selected ? monthKeyYear(selected) : null) ??
      years[years.length - 1] ??
      new Date().getFullYear(),
  );

  if (monthKeys.length === 0) {
    return null;
  }

  const yearIndex = years.indexOf(year);
  const visible = monthKeys
    .filter((key) => monthKeyYear(key) === year)
    .sort((left, right) => left.localeCompare(right));

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface-2 px-3.5 py-2">
      <Link
        href="/companies"
        aria-current={selected === null ? "page" : undefined}
        data-testid="chase-month-open"
        className={`rounded-md border px-2.5 py-1 text-[12px] whitespace-nowrap ${
          selected === null
            ? "border-accent bg-accent font-semibold text-accent-ink"
            : "border-line bg-surface text-ink-2 hover:border-line-2"
        }`}
      >
        Otvorené mesiace
      </Link>

      <span aria-hidden className="h-4 w-px bg-line-2" />

      {years.length > 1 ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setYear(years[Math.max(0, yearIndex - 1)]!)}
            disabled={yearIndex <= 0}
            aria-label="Predchádzajúci rok"
            className="grid size-[22px] place-items-center rounded-md border border-line-2 bg-surface text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40"
          >
            ‹
          </button>
          <b className="min-w-[34px] text-center font-mono text-[12px] font-semibold text-ink-2">
            {year}
          </b>
          <button
            type="button"
            onClick={() => setYear(years[Math.min(years.length - 1, yearIndex + 1)]!)}
            disabled={yearIndex >= years.length - 1}
            aria-label="Nasledujúci rok"
            className="grid size-[22px] place-items-center rounded-md border border-line-2 bg-surface text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40"
          >
            ›
          </button>
        </div>
      ) : (
        <b className="font-mono text-[12px] font-semibold text-ink-2">{year}</b>
      )}

      <nav aria-label="Mesiace" className="flex flex-wrap gap-1">
        {visible.map((key) => {
          const current = key === selected;
          return (
            <Link
              key={key}
              href={`/companies?month=${key}`}
              aria-current={current ? "page" : undefined}
              data-testid={`chase-month-${key}`}
              title={key}
              className={`rounded-md border px-2.5 py-1 text-[12px] whitespace-nowrap ${
                current
                  ? "border-accent bg-accent font-semibold text-accent-ink"
                  : "border-line bg-surface text-ink-2 hover:border-line-2"
              }`}
            >
              {monthShortLabel(key)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
