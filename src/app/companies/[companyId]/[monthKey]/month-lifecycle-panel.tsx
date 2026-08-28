"use client";

import { useState, useTransition } from "react";
import { closeMonthAction, reopenMonthAction } from "../../actions";

type MonthLifecyclePanelProps = {
  companyId: number;
  monthKey: string;
  readOnly: boolean;
  isOpenMonth: boolean;
};

export function MonthLifecyclePanel({
  companyId,
  monthKey,
  readOnly,
  isOpenMonth,
}: MonthLifecyclePanelProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const showClose = isOpenMonth && !readOnly;
  const showReopen = readOnly;

  if (!showClose && !showReopen) {
    return null;
  }

  function onClose() {
    setError(null);
    startTransition(async () => {
      const result = await closeMonthAction({ companyId, monthKey });
      if (!result.ok) {
        setError(result.message);
      }
    });
  }

  function onReopen() {
    setError(null);
    startTransition(async () => {
      const result = await reopenMonthAction({ companyId, monthKey });
      if (!result.ok) {
        setError(result.message);
      }
    });
  }

  return (
    <div
      className="rounded-lg border border-border p-4"
      data-testid="month-lifecycle-panel"
    >
      {readOnly ? (
        <p className="text-sm text-muted-foreground" data-testid="month-read-only">
          This month is closed and read-only. Ticking, pairing, editing and export
          are disabled.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {showClose ? (
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            onClick={onClose}
            disabled={pending}
            data-testid="close-month"
          >
            {pending ? "Closing…" : "Close month"}
          </button>
        ) : null}
        {showReopen ? (
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            onClick={onReopen}
            disabled={pending}
            data-testid="reopen-month"
          >
            {pending ? "Reopening…" : "Reopen month"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-700" data-testid="month-lifecycle-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
