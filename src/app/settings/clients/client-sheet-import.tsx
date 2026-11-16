"use client";

import { useMemo, useState, useTransition } from "react";
import {
  selectAdresarWrites,
  selectClientSheetWrites,
  tickKey,
  type ClientSheetDecisions,
  type ClientSheetPlan,
  type FieldChange,
  type OfficeChange,
  type PlannedRow,
} from "@/modules/client-sheet";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export type ClientSheetImportProps = {
  previewAction: (text: string) => Promise<Result<ClientSheetPlan>>;
  applyAction: (
    text: string,
    decisions: ClientSheetDecisions,
  ) => Promise<Result<{ companies: number; adresar: number; fields: number }>>;
};

/** Slovak counts: 1 firma, 2–4 firmy, 5 and more firiem (the same for polia / pole / polí). */
function firmy(count: number): string {
  return `${count} ${count === 1 ? "firma" : count >= 2 && count <= 4 ? "firmy" : "firiem"}`;
}

function polia(count: number): string {
  return `${count} ${count === 1 ? "pole" : count >= 2 && count <= 4 ? "polia" : "polí"}`;
}

function subjekty(count: number): string {
  return `${count} ${count === 1 ? "subjekt" : count >= 2 && count <= 4 ? "subjekty" : "subjektov"}`;
}

/** What a write makes, in one line: the companies, the Adresár subjects, the fields. */
function writeSummary(companies: number, adresar: number, fields: number): string {
  const parts = [
    companies > 0 ? firmy(companies) : null,
    adresar > 0 ? `${subjekty(adresar)} do Adresára` : null,
    polia(fields),
  ];
  return parts.filter((part): part is string => part !== null).join(", ");
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

/**
 * The office's client sheet, in two steps: she picks the CSV and sees the plan;
 * the write happens only on *Zapísať*, and only what she ticked or confirmed.
 * The rules are the same module the server uses, so the count shown is the count written.
 */
export function ClientSheetImport({ previewAction, applyAction }: ClientSheetImportProps) {
  const [sheet, setSheet] = useState<{ name: string; text: string } | null>(null);
  const [plan, setPlan] = useState<ClientSheetPlan | null>(null);
  const [confirmed, setConfirmed] = useState<Set<number>>(() => new Set());
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decisions = useMemo<ClientSheetDecisions>(
    () => ({ confirmedRows: [...confirmed], tickedFields: [...ticked] }),
    [confirmed, ticked],
  );
  const writes = useMemo(() => (plan ? selectClientSheetWrites(plan, decisions) : []), [plan, decisions]);
  const adresarWrites = useMemo(() => (plan ? selectAdresarWrites(plan, decisions) : []), [plan, decisions]);
  const writtenFields = [...writes, ...adresarWrites].reduce(
    (total, write) => total + write.written.length + write.office.length,
    0,
  );
  const writeCount = writes.length + adresarWrites.length;

  function chooseFile(file: File) {
    setDone(null);
    setError(null);
    startTransition(async () => {
      const text = await file.text();
      const result = await previewAction(text);
      if (!result.ok) {
        setSheet(null);
        setPlan(null);
        setError(result.message);
        return;
      }
      setSheet({ name: file.name, text });
      setPlan(result.data);
      setConfirmed(new Set());
      setTicked(new Set());
    });
  }

  function apply() {
    if (!sheet) {
      return;
    }
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await applyAction(sheet.text, decisions);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone(
        result.data.companies + result.data.adresar === 0
          ? "Nič sa nezapísalo."
          : `Zapísané: ${writeSummary(result.data.companies, result.data.adresar, result.data.fields)}.`,
      );
      // Show the sheet as it stands now: what was written is no longer a change.
      const refreshed = await previewAction(sheet.text);
      if (refreshed.ok) {
        setPlan(refreshed.data);
      }
      setConfirmed(new Set());
      setTicked(new Set());
    });
  }

  function reset() {
    setSheet(null);
    setPlan(null);
    setError(null);
    setDone(null);
    setConfirmed(new Set());
    setTicked(new Set());
  }

  function toggle<T>(set: Set<T>, value: T, on: boolean): Set<T> {
    const next = new Set(set);
    if (on) {
      next.add(value);
    } else {
      next.delete(value);
    }
    return next;
  }

  return (
    <div className="space-y-7">
      {!plan ? (
        <section className="inset-group p-4">
          <label className="press inline-flex cursor-pointer items-center rounded-[9px] bg-accent px-3.5 py-1.5 text-[13.5px] font-semibold text-white">
            Vybrať CSV tabuľku…
            <input
              type="file"
              accept=".csv,text/csv"
              data-testid="client-sheet-file"
              className="sr-only"
              disabled={pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  chooseFile(file);
                }
              }}
            />
          </label>
          <p className="mt-3 text-[12.5px] text-ink-3">
            {pending ? "Čítam tabuľku…" : "Tabuľka obsahuje údaje klientov. Nahráva sa len do tejto aplikácie a nikde sa neukladá."}
          </p>
        </section>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] text-ink-2">
            Náhľad z <span className="font-medium">{sheet?.name}</span>
          </p>
          <button type="button" onClick={reset} className="press rounded-[9px] bg-fill px-3 py-1.5 text-[13px] font-medium">
            Iný súbor
          </button>
        </section>
      )}

      {error ? (
        <p role="alert" className="text-[13.5px] text-bad">
          {error}
        </p>
      ) : null}

      {done ? (
        <p role="status" data-testid="client-sheet-done" className="text-[13.5px] text-good">
          {done}
        </p>
      ) : null}

      {plan ? (
        <>
          <p data-testid="client-sheet-summary" className="text-[13.5px] text-ink-2">
            Riadkov {plan.rows.length}: nové {plan.counts.new}, zmenené {plan.counts.changed}, bez zmeny{" "}
            {plan.counts.unchanged}, do Adresára {plan.counts.adresar}, bez IČO {plan.counts["no-ico"]}, neplatné{" "}
            {plan.counts.invalid}, nespárované {plan.counts.unmatched}, nesúlady {plan.counts.disagreements}, odhady
            podľa názvu {plan.counts.guesses}.
          </p>

          <ChangeSection
            testId="section-new"
            title="Nové profily"
            rows={plan.rows.filter((row) => row.status === "new")}
            ticked={ticked}
            confirmed={confirmed}
            onTick={(key, on) => setTicked((set) => toggle(set, key, on))}
            onConfirm={(rowNumber, on) => setConfirmed((set) => toggle(set, rowNumber, on))}
          />
          <ChangeSection
            testId="section-changed"
            title="Zmenené profily"
            rows={plan.rows.filter((row) => row.status === "changed")}
            ticked={ticked}
            confirmed={confirmed}
            onTick={(key, on) => setTicked((set) => toggle(set, key, on))}
            onConfirm={(rowNumber, on) => setConfirmed((set) => toggle(set, rowNumber, on))}
          />
          <ChangeSection
            testId="section-adresar"
            title="Do Adresára"
            rows={plan.rows.filter((row) => row.status === "adresar")}
            ticked={ticked}
            confirmed={confirmed}
            onTick={(key, on) => setTicked((set) => toggle(set, key, on))}
            onConfirm={(rowNumber, on) => setConfirmed((set) => toggle(set, rowNumber, on))}
          />
          <ReasonSection
            testId="section-no-ico"
            title="Bez IČO — neuloží sa"
            rows={plan.rows.filter((row) => row.status === "no-ico")}
          />
          <ReasonSection
            testId="section-invalid"
            title="Neplatné údaje — neuloží sa"
            rows={plan.rows.filter((row) => row.status === "invalid")}
          />
          <ReasonSection
            testId="section-unmatched"
            title="Nespárované — len na prehľad"
            rows={plan.rows.filter((row) => row.status === "unmatched")}
          />
          <DisagreementSection rows={plan.rows.filter((row) => row.disagreements.length > 0)} />
          <UnchangedSection rows={plan.rows.filter((row) => row.status === "unchanged")} />

          <div
            role="region"
            aria-label="Zápis do profilov"
            className="glass rise-in fixed inset-x-0 bottom-6 z-30 mx-auto flex w-fit max-w-[calc(100vw-32px)] flex-wrap items-center gap-2.5 rounded-2xl py-2 pr-2 pl-4 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_10px_32px_rgb(0_0_0/0.16)]"
          >
            <span data-testid="client-sheet-write-count" className="text-[13.5px] text-ink-2">
              {writeCount === 0
                ? "Nič sa nezapíše."
                : `Zapíše sa ${writeSummary(writes.length, adresarWrites.length, writtenFields)}.`}
            </span>
            <button
              type="button"
              data-testid="client-sheet-apply"
              onClick={apply}
              disabled={pending || writeCount === 0}
              className="press rounded-[9px] bg-accent px-3.5 py-1.5 text-[13.5px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Zapisujem…" : "Zapísať"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="mx-4 mb-1.5 flex items-baseline justify-between gap-2">
      <h2 className="eyebrow">{title}</h2>
      <span className="text-[12px] text-ink-3">{count}</span>
    </div>
  );
}

function ChangeSection({
  testId,
  title,
  rows,
  ticked,
  confirmed,
  onTick,
  onConfirm,
}: {
  testId: string;
  title: string;
  rows: PlannedRow[];
  ticked: Set<string>;
  confirmed: Set<number>;
  onTick: (key: string, on: boolean) => void;
  onConfirm: (rowNumber: number, on: boolean) => void;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section data-testid={testId}>
      <SectionHeading title={title} count={rows.length} />
      <ul className="inset-group">
        {rows.map((row) => (
          <li key={row.rowNumber} data-testid={`row-${row.rowNumber}`} className="border-t border-line px-4 py-3 first:border-t-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[14px] font-medium">{row.companyName}</span>
              <span className="text-[12.5px] text-ink-3">IČO {row.ico}</span>
              {row.guess ? <span className="text-[12px] text-warn">odhad podľa názvu</span> : null}
              {row.companyId === null ? <span className="text-[12px] text-ink-3">bez priečinka Doklady</span> : null}
            </div>
            <ul className="mt-1.5 space-y-1">
              {row.fields.map((change) => (
                <FieldRow
                  key={change.field}
                  rowNumber={row.rowNumber}
                  change={change}
                  ticked={ticked.has(tickKey(row.rowNumber, change.field))}
                  onTick={onTick}
                />
              ))}
              {row.officeChanges.map((change) => (
                <OfficeRow key={change.field} rowNumber={row.rowNumber} change={change} />
              ))}
            </ul>
            {row.guess ? (
              <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                <input
                  type="checkbox"
                  data-testid={`confirm-${row.rowNumber}`}
                  checked={confirmed.has(row.rowNumber)}
                  onChange={(event) => onConfirm(row.rowNumber, event.target.checked)}
                />
                Potvrdiť: ide o túto firmu. Bez potvrdenia sa nezapíše.
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FieldRow({
  rowNumber,
  change,
  ticked,
  onTick,
}: {
  rowNumber: number;
  change: FieldChange;
  ticked: boolean;
  onTick: (key: string, on: boolean) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <span className="text-ink-3">{change.label}:</span>
      {change.old === null ? null : isBlank(change.old) ? (
        <span className="text-ink-4">prázdne</span>
      ) : (
        <span className="text-ink-3 line-through">{change.old}</span>
      )}
      {change.old === null ? null : <span aria-hidden className="text-ink-4">→</span>}
      <span className="font-medium">{change.next}</span>
      {change.kind === "change" ? (
        <label className="ml-1 flex items-center gap-1.5 text-[12.5px] text-warn">
          <input
            type="checkbox"
            data-testid={`tick-${rowNumber}-${change.field}`}
            checked={ticked}
            onChange={(event) => onTick(tickKey(rowNumber, change.field), event.target.checked)}
          />
          Prepísať uloženú hodnotu
        </label>
      ) : null}
    </li>
  );
}

/** The office's own data (Vedie, Spolupráca, the client flag): the sheet's, written without a tick. */
function OfficeRow({ rowNumber, change }: { rowNumber: number; change: OfficeChange }) {
  return (
    <li data-testid={`office-${rowNumber}-${change.field}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <span className="text-ink-3">{change.label}:</span>
      {change.old === null ? null : isBlank(change.old) ? (
        <span className="text-ink-4">prázdne</span>
      ) : (
        <span className="text-ink-3 line-through">{change.old}</span>
      )}
      {change.old === null ? null : <span aria-hidden className="text-ink-4">→</span>}
      <span className="font-medium">{change.next}</span>
    </li>
  );
}

function ReasonSection({ testId, title, rows }: { testId: string; title: string; rows: PlannedRow[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section data-testid={testId}>
      <SectionHeading title={title} count={rows.length} />
      <ul className="inset-group">
        {rows.map((row) => (
          <li key={row.rowNumber} className="border-t border-line px-4 py-2.5 first:border-t-0">
            <span className="text-[14px] font-medium">{row.companyName ?? row.client}</span>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              Riadok {row.rowNumber}
              {row.reason ? `: ${row.reason}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DisagreementSection({ rows }: { rows: PlannedRow[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section data-testid="section-disagreements">
      <SectionHeading title="Nesúlady s Drive" count={rows.length} />
      <ul className="inset-group">
        {rows.map((row) => (
          <li key={row.rowNumber} className="border-t border-line px-4 py-2.5 first:border-t-0">
            <span className="text-[14px] font-medium">{row.companyName}</span>
            <ul className="mt-0.5 space-y-0.5">
              {row.disagreements.map((message) => (
                <li key={message} className="text-[12.5px] text-ink-3">
                  {message}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UnchangedSection({ rows }: { rows: PlannedRow[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section data-testid="section-unchanged">
      <details className="inset-group">
        <summary className="cursor-pointer px-4 py-3 text-[14px]">
          Bez zmeny: {rows.length}
        </summary>
        <ul>
          {rows.map((row) => (
            <li key={row.rowNumber} className="border-t border-line px-4 py-2 text-[13px] text-ink-2">
              {row.companyName}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
