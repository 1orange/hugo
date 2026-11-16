import {
  identityStateLabel,
  type IdentityFieldState,
  type IdentityRow,
  type IdentitySummary,
} from "@/modules/identity-states";
import { RestoreRegisterValueButton, type RestoreResult } from "./restore-register-value-button";

/**
 * The identity states of a subject (0006/03): overené, upravené ručne, neoverené. Shared
 * by the Adresár list and entry and the company's profile, so the states read the same
 * everywhere.
 */

const TONE_CLASSES: Record<IdentityRow["tone"], string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-surface-2 text-ink-2",
};

const DOT_CLASSES: Record<IdentityRow["tone"], string> = {
  good: "bg-good-dot",
  warn: "bg-warn-dot",
  neutral: "bg-ink-4",
};

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full ${className}`} />;
}

export function IdentityStateBadge({
  state,
  label,
  tone,
  testId,
}: {
  state: IdentityFieldState;
  label?: string;
  tone: IdentityRow["tone"];
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-state={state}
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium ${TONE_CLASSES[tone]}`}
    >
      {label ?? identityStateLabel(state)}
    </span>
  );
}

/** The Adresár list's compact summary: how many fields of the subject are in each state. */
export function IdentityStateSummary({ summary, testId }: { summary: IdentitySummary; testId: string }) {
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1 whitespace-nowrap text-[12px] text-ink-2" data-testid={testId}>
      <span className="inline-flex items-center gap-1.5">
        <Dot className={DOT_CLASSES.good} />
        {summary.overene} {identityStateLabel("overene")}
      </span>
      {summary.upraveneRucne > 0 ? (
        <span className="inline-flex items-center gap-1.5 text-warn">
          <Dot className={DOT_CLASSES.warn} />
          {summary.upraveneRucne} {identityStateLabel("upravene-rucne")}
        </span>
      ) : null}
      {summary.neoverene > 0 ? (
        <span className="inline-flex items-center gap-1.5 text-ink-3">
          <Dot className={DOT_CLASSES.neutral} />
          {summary.neoverene} {identityStateLabel("neoverene")}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Each identity field with its value, its state, and for a hand edit the register's value
 * beside it, with the one-click return to that value.
 */
export function IdentityStateList({
  rows,
  subjectId,
  onRestore,
}: {
  rows: IdentityRow[];
  subjectId: number;
  onRestore: (input: { subjectId: number; field: string }) => Promise<RestoreResult>;
}) {
  return (
    <ul className="inset-group divide-y divide-line" data-testid="identity-states">
      {rows.map((row) => (
        <li
          key={row.field}
          data-testid={`identity-row-${row.field}`}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
        >
          <span className="w-28 shrink-0 text-[12.5px] text-ink-2">{row.label}</span>
          <span className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink" data-testid={`identity-value-${row.field}`}>
            {row.value ?? "—"}
          </span>
          <IdentityStateBadge state={row.state} label={row.stateLabel} tone={row.tone} testId={`identity-state-${row.field}`} />
          {row.restorable && row.registerValue !== null ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-ink-3">
              <span>
                register: <span className="font-mono text-ink-2" data-testid={`identity-register-${row.field}`}>{row.registerValue}</span>
              </span>
              <RestoreRegisterValueButton
                subjectId={subjectId}
                field={row.field}
                onRestore={onRestore}
                testId={`identity-restore-${row.field}`}
              />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
