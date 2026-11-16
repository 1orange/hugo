"use client";

import { MonthStepper } from "@/components/app/month-stepper";

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
  if (monthKeys.length === 0) {
    return null;
  }
  return (
    <MonthStepper
      testId="chase-month-picker"
      currentKey={selected}
      all={{ label: "Otvorené mesiace", href: "/companies", testId: "chase-month-open" }}
      months={[...monthKeys]
        .sort((left, right) => left.localeCompare(right))
        .map((monthKey) => ({
          monthKey,
          href: `/companies?month=${monthKey}`,
          testId: `chase-month-${monthKey}`,
        }))}
    />
  );
}
