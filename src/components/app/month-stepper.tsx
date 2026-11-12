"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { monthKeyYear, monthLabel, monthShortLabel } from "@/modules/format-sk";
import { useDismiss } from "./use-dismiss";

export type MonthStepperItem = {
  monthKey: string;
  href: string;
  closed?: boolean;
  testId: string;
};

type MonthStepperProps = {
  /** Every month she can go to, oldest first. */
  months: MonthStepperItem[];
  /** The month shown; null when the screen shows something else (`all`). */
  currentKey: string | null;
  /** A choice before the months, such as *Otvorené mesiace* on Firmy. */
  all?: { label: string; href: string; testId: string };
  /** Names the trigger, for tests. */
  testId: string;
};

const STEP =
  "press grid size-7 place-items-center rounded-[7px] text-ink-2 hover:bg-fill-2 aria-disabled:pointer-events-none aria-disabled:text-ink-4";

/**
 * A month as a stepper: ‹ november 2026 ›. The arrows step to the neighbouring
 * month; the name opens every month by year, closed ones marked with a lock.
 */
export function MonthStepper({
  months,
  currentKey,
  all,
  testId,
}: MonthStepperProps) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDetailsElement>(open, () => setOpen(false));

  const index =
    currentKey === null
      ? -1
      : months.findIndex((month) => month.monthKey === currentKey);
  const current = index >= 0 ? months[index] : null;
  // From "all", the step back is the latest month.
  const previous = current ? months[index - 1] : months[months.length - 1];
  const next = current ? months[index + 1] : undefined;
  const label = current ? monthLabel(current.monthKey) : (all?.label ?? "—");

  const years = [
    ...new Set(months.map((month) => monthKeyYear(month.monthKey))),
  ]
    .filter((year): year is number => year !== null)
    .sort((left, right) => right - left);

  return (
    <div className="flex items-center rounded-[9px] bg-fill p-0.5">
      {previous ? (
        <Link
          href={previous.href}
          scroll={false}
          aria-label={`Predchádzajúci mesiac: ${monthLabel(previous.monthKey)}`}
          title={monthLabel(previous.monthKey)}
          className={STEP}
        >
          <ChevronLeft aria-hidden className="size-4" strokeWidth={2.2} />
        </Link>
      ) : (
        <span aria-disabled="true" className={STEP}>
          <ChevronLeft aria-hidden className="size-4" strokeWidth={2.2} />
        </span>
      )}

      {/* A native disclosure: it opens before the page's script has loaded, too. */}
      <details
        ref={ref}
        className="relative"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          data-testid={testId}
          className="press inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[7px] bg-surface px-3 py-1 text-[13px] font-semibold whitespace-nowrap shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] [&::-webkit-details-marker]:hidden"
        >
          {current?.closed ? (
            <Lock aria-hidden className="size-3" strokeWidth={2.4} />
          ) : null}
          {label}
          <ChevronDown
            aria-hidden
            className="size-3.5 text-ink-3"
            strokeWidth={2.4}
          />
        </summary>
        <div
          role="dialog"
          aria-label="Mesiace"
          className="glass-strong pop-in absolute top-10 left-0 z-40 w-[288px] origin-top-left rounded-xl p-2 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.16)]"
        >
          {all ? (
            <Link
              href={all.href}
              scroll={false}
              onClick={() => setOpen(false)}
              aria-current={currentKey === null ? "page" : undefined}
              data-testid={all.testId}
              className="mb-1 block rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium hover:bg-fill aria-[current=page]:bg-accent aria-[current=page]:text-white"
            >
              {all.label}
            </Link>
          ) : null}
          <nav
            aria-label="Mesiace podľa roka"
            className="flex max-h-[320px] flex-col gap-2 overflow-y-auto"
          >
            {years.map((year) => (
              <div key={year}>
                <p className="tabular px-2.5 pt-1 pb-1 text-[12px] font-semibold text-ink-3">
                  {year}
                </p>
                <div className="grid grid-cols-4 gap-1">
                  {months
                    .filter((month) => monthKeyYear(month.monthKey) === year)
                    .map((month) => (
                      <Link
                        key={month.monthKey}
                        href={month.href}
                        scroll={false}
                        onClick={() => setOpen(false)}
                        aria-current={
                          month.monthKey === currentKey ? "page" : undefined
                        }
                        data-testid={month.testId}
                        title={`${monthLabel(month.monthKey)}${month.closed ? " — uzavretý" : ""}`}
                        className={`press inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[13px] hover:bg-fill aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-white ${
                          month.closed ? "text-ink-3" : "text-ink"
                        }`}
                      >
                        {month.closed ? (
                          <Lock
                            aria-hidden
                            className="size-3"
                            strokeWidth={2.2}
                          />
                        ) : null}
                        {monthShortLabel(month.monthKey)}
                      </Link>
                    ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </details>

      {next ? (
        <Link
          href={next.href}
          scroll={false}
          aria-label={`Nasledujúci mesiac: ${monthLabel(next.monthKey)}`}
          title={monthLabel(next.monthKey)}
          className={STEP}
        >
          <ChevronRight aria-hidden className="size-4" strokeWidth={2.2} />
        </Link>
      ) : (
        <span aria-disabled="true" className={STEP}>
          <ChevronRight aria-hidden className="size-4" strokeWidth={2.2} />
        </span>
      )}
    </div>
  );
}
