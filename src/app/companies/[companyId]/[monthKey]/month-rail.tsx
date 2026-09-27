"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { closeMonthAction, reopenMonthAction } from "../../actions";
import { monthKeyYear, monthShortLabel } from "@/modules/format-sk";
import { FolderRepairPanel } from "./folder-repair-panel";
import type { MonthDocumentGroup } from "@/lib/sweep/views";
import type { MissingSlot } from "@/modules/month-lifecycle";

export type MonthRailItem = {
  monthKey: string;
  closed: boolean;
};

type MonthRailProps = {
  companyId: number;
  monthKey: string;
  months: MonthRailItem[];
  awaitingCount: number;
  decidedCount: number;
  totalCount: number;
  pendingExtractionCount: number;
  readOnly: boolean;
  isOpenMonth: boolean;
  missingSlots: MissingSlot[];
  /** Folders that still need a decision from her. */
  repairGroups: MonthDocumentGroup[];
  /** Folders the app already renamed. Done, not a problem — but undoable. */
  repairedGroups: MonthDocumentGroup[];
  canonicalFolderNames: string[];
};

/**
 * Month navigation used to not exist: the company row linked to the open month
 * and a closed month was reachable only by typing its URL. One row of chips per
 * year covers a client's whole history, closed months included.
 */
export function MonthRail({
  companyId,
  monthKey,
  months,
  awaitingCount,
  decidedCount,
  totalCount,
  pendingExtractionCount,
  readOnly,
  isOpenMonth,
  missingSlots,
  repairGroups,
  repairedGroups,
  canonicalFolderNames,
}: MonthRailProps) {
  const currentYear = monthKeyYear(monthKey);
  const years = [...new Set(months.map((month) => monthKeyYear(month.monthKey)))]
    .filter((year): year is number => year !== null)
    .sort((left, right) => left - right);

  const [year, setYear] = useState<number>(
    currentYear ?? years[years.length - 1] ?? new Date().getFullYear(),
  );
  const [healthOpen, setHealthOpen] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const yearIndex = years.indexOf(year);
  const visibleMonths = months.filter(
    (month) => monthKeyYear(month.monthKey) === year,
  );
  // A folder the app already renamed is a finished action with an undo, not an
  // unresolved problem. Counting it here was what kept a repaired folder
  // showing as outstanding with only "undo" on offer.
  const problems = missingSlots.length + repairGroups.length;
  const hasHealthDetail = problems > 0 || repairedGroups.length > 0;

  function runLifecycle(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    setConfirmingClose(false);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "Akcia zlyhala.");
      }
    });
  }

  function onCloseClicked() {
    // Closing with documents still undecided is allowed — reopening is one
    // click — but it should never happen by accident.
    if (awaitingCount > 0 && !confirmingClose) {
      setError(null);
      setConfirmingClose(true);
      return;
    }
    runLifecycle(() => closeMonthAction({ companyId, monthKey }));
  }

  return (
    <div className="shrink-0 border-b border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-2">
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
              onClick={() =>
                setYear(years[Math.min(years.length - 1, yearIndex + 1)]!)
              }
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
          {visibleMonths.map((month) => {
            const current = month.monthKey === monthKey;
            return (
              <Link
                key={month.monthKey}
                href={`/companies/${companyId}/${month.monthKey}`}
                aria-current={current ? "page" : undefined}
                data-testid={`month-chip-${month.monthKey}`}
                title={`${month.monthKey} — ${month.closed ? "uzavretý" : "otvorený"}`}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] whitespace-nowrap ${
                  current
                    ? "border-accent bg-accent font-semibold text-accent-ink"
                    : month.closed
                      ? "border-line bg-surface text-ink-3 hover:border-line-2 hover:bg-surface-2"
                      : "border-line bg-surface text-ink-2 hover:border-line-2 hover:bg-surface-2"
                }`}
              >
                <i
                  aria-hidden
                  className={`inline-block size-[5px] shrink-0 rounded-full ${
                    current
                      ? "bg-accent-ink"
                      : month.closed
                        ? "border border-ink-3"
                        : "bg-good"
                  }`}
                />
                {monthShortLabel(month.monthKey)}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setHealthOpen((open) => !open)}
          aria-expanded={healthOpen}
          data-testid="folder-health"
          className={`rounded-md border px-2.5 py-1 text-[11.5px] ${
            problems > 0
              ? "border-warn/40 bg-warn-soft text-warn"
              : "border-line-2 bg-surface text-ink-3 hover:border-accent hover:text-accent"
          }`}
        >
          {problems > 0
            ? `Priečinky: ${problems} na vyriešenie`
            : repairedGroups.length > 0
              ? "Priečinky v poriadku · 1 oprava sa dá vrátiť"
              : "Priečinky v poriadku"}
        </button>

        {pendingExtractionCount > 0 ? (
          <span
            className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-1 text-[11.5px] whitespace-nowrap text-accent"
            data-testid="extraction-running"
          >
            <i className="inline-block size-1.5 animate-pulse rounded-full bg-accent" />
            Spracúvam {pendingExtractionCount}…
          </span>
        ) : null}

        <span className="flex items-center gap-2.5">
          <span className="text-[11.5px] whitespace-nowrap text-ink-3">
            {decidedCount} z {totalCount} rozhodnutých
          </span>
          <span className="h-[5px] w-24 overflow-hidden rounded-full bg-surface-3">
            <i
              className="block h-full rounded-full bg-good transition-[width] duration-200"
              style={{
                width: `${totalCount === 0 ? 0 : (decidedCount / totalCount) * 100}%`,
              }}
            />
          </span>
        </span>

        {readOnly ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => runLifecycle(() => reopenMonthAction({ companyId, monthKey }))}
            data-testid="reopen-month"
            className="rounded-md border border-line-2 bg-surface px-2.5 py-1 text-[12px] text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {pending ? "Otváram…" : "Znovu otvoriť"}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={onCloseClicked}
            data-testid="close-month"
            title={
              isOpenMonth
                ? "Uzavrieť mesiac po podaní DPH"
                : "Uzavrieť tento starší mesiac"
            }
            className={`rounded-md border px-2.5 py-1 text-[12px] ${
              confirmingClose
                ? "border-warn bg-warn text-warn-soft"
                : "border-line-2 bg-surface text-ink-2 hover:border-accent hover:text-accent"
            } disabled:opacity-40`}
          >
            {pending
              ? "Uzatváram…"
              : confirmingClose
                ? "Naozaj uzavrieť?"
                : "Uzavrieť mesiac"}
          </button>
        )}
      </div>

      {confirmingClose && !readOnly ? (
        <p className="flex flex-wrap items-center gap-2 border-t border-line bg-warn-soft px-3.5 py-1.5 text-[12px] text-warn">
          <span>
            Ešte {awaitingCount}{" "}
            {awaitingCount === 1
              ? "doklad čaká"
              : awaitingCount < 5
                ? "doklady čakajú"
                : "dokladov čaká"}{" "}
            na rozhodnutie. Uzavretý mesiac sa dá kedykoľvek znovu otvoriť.
          </span>
          <button
            type="button"
            onClick={() => setConfirmingClose(false)}
            className="underline underline-offset-2"
          >
            Zrušiť
          </button>
        </p>
      ) : null}

      {error ? (
        <p
          className="border-t border-line bg-bad-soft px-3.5 py-1.5 text-[12px] text-bad"
          role="alert"
          data-testid="month-lifecycle-error"
        >
          {error}
        </p>
      ) : null}

      {readOnly ? (
        <p
          className="flex items-center gap-2 border-t border-line bg-warn-soft px-3.5 py-1.5 text-[12px] text-warn"
          data-testid="month-read-only"
        >
          <span aria-hidden>●</span>
          <span>
            <b>{monthKey} je uzavretý.</b> Údaje, rozhodnutia a export sú len na
            čítanie. Ak sem patrí neskoro doručený doklad, mesiac znovu otvor.
          </span>
        </p>
      ) : null}

      {healthOpen ? (
        <div
          className="border-t border-line bg-surface-2 px-3.5 py-3"
          data-testid="folder-health-panel"
        >
          {!hasHealthDetail ? (
            <p className="text-[12.5px] text-ink-2">
              Všetky očakávané priečinky existujú a majú kanonické názvy.
            </p>
          ) : null}

          {missingSlots.length > 0 ? (
            <section data-testid="missing-slots">
              <h3 className="eyebrow">Chýbajúce priečinky</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {missingSlots.map((slot) => (
                  <li
                    key={slot.canonicalName}
                    className="rounded-md border border-line bg-surface px-2.5 py-2 text-[12.5px]"
                  >
                    <p className="font-medium">{slot.canonicalName}</p>
                    <p className="text-ink-3">
                      {slot.blockedByFolderName
                        ? `Nevytvorený, lebo „${slot.blockedByFolderName}“ už používa toto číslo. Oprav alebo premenuj ten priečinok a načítaj Drive znova.`
                        : "Zatiaľ neexistuje. Vytvorí sa pri založení mesiaca."}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {repairGroups.length > 0 ? (
            <section className={missingSlots.length > 0 ? "mt-3" : ""}>
              <h3 className="eyebrow">Priečinky na opravu</h3>
              <div className="mt-2 flex flex-col gap-2">
                {repairGroups.map((group) => (
                  <FolderRepairPanel
                    key={group.driveFolderId}
                    companyId={companyId}
                    monthKey={monthKey}
                    driveFolderId={group.driveFolderId}
                    observedName={group.observedName}
                    proposedTargetName={group.proposedTargetName}
                    kind={
                      group.kind === "vat-output"
                        ? "unknown"
                        : (group.kind as "canonical" | "repair-candidate" | "unknown")
                    }
                    canRename={group.canRename}
                    renameBlockedReason={group.renameBlockedReason}
                    activeMutationId={group.activeMutationId}
                    canonicalFolderNames={canonicalFolderNames}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {repairedGroups.length > 0 ? (
            <section
              className={problems > 0 ? "mt-3" : ""}
              data-testid="repaired-folders"
            >
              <h3 className="eyebrow">Premenované aplikáciou</h3>
              <p className="mt-1 text-[12px] text-ink-3">
                Hotové — tieto priečinky už majú kanonický názov. Vrátenie obnoví
                predchádzajúci názov v Drive.
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {repairedGroups.map((group) => (
                  <FolderRepairPanel
                    key={group.driveFolderId}
                    companyId={companyId}
                    monthKey={monthKey}
                    driveFolderId={group.driveFolderId}
                    observedName={group.observedName}
                    proposedTargetName={group.proposedTargetName}
                    kind="canonical"
                    canRename={group.canRename}
                    renameBlockedReason={group.renameBlockedReason}
                    activeMutationId={group.activeMutationId}
                    canonicalFolderNames={canonicalFolderNames}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
