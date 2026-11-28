"use client";

import { MonthStepper } from "@/components/app/month-stepper";
import { OPEN_MONTHS_PARAM } from "@/modules/companies-month";

type ChaseMonthPickerProps = {
  monthKeys: string[];
  selected: string | null;
};

/**
 * Picking a calendar month switches every row to that month, so the office can
 * review the month it books. *Otvorené mesiace* is the explicit option for each
 * company's own open month, the daily chase question; it has its own URL.
 */
export function ChaseMonthPicker({ monthKeys, selected }: ChaseMonthPickerProps) {
  if (monthKeys.length === 0) {
    return null;
  }
  return (
    <MonthStepper
      testId="chase-month-picker"
      currentKey={selected}
      all={{
        label: "Otvorené mesiace",
        href: `/companies?month=${OPEN_MONTHS_PARAM}`,
        testId: "chase-month-open",
      }}
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
