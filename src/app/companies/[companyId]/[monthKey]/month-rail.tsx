"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Folder, Lock } from "lucide-react";
import { useDismiss } from "@/components/app/use-dismiss";
import { closeMonthAction, reopenMonthAction } from "../../actions";
import { countWithNoun, DOKLAD_FORMS, monthLabel } from "@/modules/format-sk";
import { MonthStepper } from "@/components/app/month-stepper";
import { FolderRepairPanel } from "./folder-repair-panel";
import type { FutureMonthUpload, MonthDocumentGroup } from "@/lib/sweep/views";
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
  /** Documents already uploaded into months that have not started yet. */
  futureUploads: FutureMonthUpload[];
  /** Folders that still need a decision from her. */
  repairGroups: MonthDocumentGroup[];
  /** Folders the app already renamed. Done, not a problem — but undoable. */
  repairedGroups: MonthDocumentGroup[];
  canonicalFolderNames: string[];
  /** The month's export, a toolbar button with its own popover. */
  exportControl?: ReactNode;
};

/**
 * The month's toolbar: its place in the client's history (one segmented row per
 * year, closed months included), how far she is, the folders and the export as
 * popovers, and closing. Banners below it say what she cannot change.
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
  futureUploads,
  repairGroups,
  repairedGroups,
  canonicalFolderNames,
  exportControl,
}: MonthRailProps) {
  const [healthOpen, setHealthOpen] = useState(false);
  const healthRef = useDismiss<HTMLDivElement>(healthOpen, () => setHealthOpen(false));
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    <div className="shrink-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-2 px-4 py-2 sm:px-6">
        <MonthStepper
          testId="month-picker"
          currentKey={monthKey}
          months={months.map((month) => ({
            monthKey: month.monthKey,
            href: `/companies/${companyId}/${month.monthKey}`,
            closed: month.closed,
            testId: `month-chip-${month.monthKey}`,
          }))}
        />

        <div className="flex-1" />

        {pendingExtractionCount > 0 ? (
          <span
            className="flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[12.5px] font-medium whitespace-nowrap text-accent"
            data-testid="extraction-running"
          >
            <i className="inline-block size-[7px] animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            Spracúvam {pendingExtractionCount}…
          </span>
        ) : null}

        <span className="flex items-center gap-2.5" aria-label="Postup mesiaca">
          <span className="tabular text-[13px] whitespace-nowrap text-ink-3">
            <strong className="font-semibold text-ink">{decidedCount}</strong> z {totalCount} rozhodnutých
          </span>
          <span aria-hidden className="h-[5px] w-24 overflow-hidden rounded-full bg-fill-2">
            <i
              className="block h-full rounded-full bg-good-dot transition-[width] duration-500 ease-[var(--ease-out-soft)] motion-reduce:transition-none"
              style={{ width: `${totalCount === 0 ? 0 : (decidedCount / totalCount) * 100}%` }}
            />
          </span>
        </span>

        <div className="relative" ref={healthRef}>
          <button
            type="button"
            onClick={() => setHealthOpen((open) => !open)}
            aria-expanded={healthOpen}
            data-testid="folder-health"
            className={`press inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium shadow-[0_0_0_1px_rgb(0_0_0/0.08)] ${
              healthOpen ? "bg-accent-soft" : "bg-surface hover:bg-surface-2"
            }`}
          >
            <Folder aria-hidden className="size-[15px]" strokeWidth={1.9} />
            Priečinky
            {problems > 0 ? (
              <span className="tabular grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#f3d9a4] px-1.5 text-[11.5px] font-bold text-warn-strong">
                {problems}
              </span>
            ) : (
              <span className="sr-only">v poriadku</span>
            )}
          </button>
          {healthOpen ? (
            <div
              className="glass-strong pop-in absolute top-11 right-0 z-40 max-h-[70vh] w-[420px] max-w-[calc(100vw-32px)] origin-top-right overflow-y-auto rounded-xl p-4 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.16)]"
              data-testid="folder-health-panel"
              role="dialog"
              aria-label="Priečinky mesiaca"
            >
              <p className="text-[15px] font-semibold">
                {problems > 0 ? `${problems} na vyriešenie` : "Priečinky sú v poriadku"}
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                {repairedGroups.length > 0
                  ? "Premenovanie sa dá vrátiť. Hugo nič nevytvára ani nemaže."
                  : "Hugo nič nevytvára ani nemaže; premenovanie sa dá vrátiť."}
              </p>
              {!hasHealthDetail ? (
                <p className="mt-3 text-[13px] text-ink-2">Všetky očakávané priečinky existujú a majú správne názvy.</p>
              ) : null}

              {missingSlots.length > 0 ? (
                <section data-testid="missing-slots" className="mt-3">
                  <h3 className="eyebrow">Chýbajúce priečinky</h3>
                  <ul className="mt-1.5 flex flex-col">
                    {missingSlots.map((slot) => (
                      <li key={slot.canonicalName} className="border-t border-line py-2 text-[13px] first:border-t-0">
                        <p className="font-medium">{slot.canonicalName}</p>
                        <p className="text-[12.5px] text-ink-3">
                          {slot.blockedByFolderName
                            ? `Nevytvorený, lebo „${slot.blockedByFolderName}“ už používa toto číslo. Oprav alebo premenuj ten priečinok a načítaj Drive znova.`
                            : "Zatiaľ neexistuje. Vytvor ho v Drive; Hugo ho uvidí pri najbližšom načítaní Drive."}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {repairGroups.length > 0 ? (
                <section className="mt-3">
                  <h3 className="eyebrow">Priečinky na opravu</h3>
                  <div className="mt-1.5 flex flex-col gap-2">
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
                <section className="mt-3" data-testid="repaired-folders">
                  <h3 className="eyebrow">Premenované aplikáciou</h3>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">
                    Hotové — tieto priečinky už majú správny názov. Vrátenie obnoví predchádzajúci názov v Drive.
                  </p>
                  <div className="mt-1.5 flex flex-col gap-2">
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

        {exportControl}

        {readOnly ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => runLifecycle(() => reopenMonthAction({ companyId, monthKey }))}
            data-testid="reopen-month"
            className="press rounded-lg bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink shadow-[0_0_0_1px_rgb(0_0_0/0.08)] hover:bg-surface-2 disabled:opacity-50"
          >
            {pending ? "Otváram…" : "Znovu otvoriť"}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={onCloseClicked}
            data-testid="close-month"
            title={isOpenMonth ? "Uzavrieť mesiac po podaní DPH" : "Uzavrieť tento starší mesiac"}
            className={`press rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 ${
              confirmingClose ? "bg-warn-dot text-white" : "bg-ink text-white hover:bg-ink-2"
            }`}
          >
            {pending ? "Uzatváram…" : confirmingClose ? "Naozaj uzavrieť?" : "Uzavrieť mesiac"}
          </button>
        )}
      </div>

      {confirmingClose && !readOnly ? (
        <p className="fade-in flex flex-wrap items-center gap-2 border-b border-line bg-warn-soft px-4 py-2 text-[13px] text-warn-strong sm:px-6">
          <span>
            Ešte {awaitingCount}{" "}
            {awaitingCount === 1 ? "doklad čaká" : awaitingCount < 5 ? "doklady čakajú" : "dokladov čaká"} na
            rozhodnutie. Uzavretý mesiac sa dá kedykoľvek znovu otvoriť.
          </span>
          <button type="button" onClick={() => setConfirmingClose(false)} className="font-semibold hover:underline">
            Zrušiť
          </button>
        </p>
      ) : null}

      {error ? (
        <p
          className="border-b border-line bg-bad-soft px-4 py-2 text-[13px] text-bad sm:px-6"
          role="alert"
          data-testid="month-lifecycle-error"
        >
          {error}
        </p>
      ) : null}

      {readOnly ? (
        <p
          className="flex items-center gap-2 border-b border-line bg-[#f7f1e3] px-4 py-2 text-[13px] text-warn-strong sm:px-6"
          data-testid="month-read-only"
        >
          <Lock aria-hidden className="size-3.5 shrink-0" strokeWidth={2.2} />
          <span>
            <b className="font-semibold">{monthLabel(monthKey)} je uzavretý.</b> Údaje, rozhodnutia a export sú len
            na čítanie. Ak sem patrí neskoro doručený doklad, mesiac znovu otvor.
          </span>
        </p>
      ) : null}

      {futureUploads.length > 0 ? (
        <p
          className="flex flex-wrap items-center gap-x-2 border-b border-line bg-accent-soft px-4 py-2 text-[13px] text-accent sm:px-6"
          data-testid="future-uploads"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          <span>
            <b className="font-semibold">Nahraté do budúceho mesiaca:</b>{" "}
            {futureUploads
              .map((upload) => `${countWithNoun(upload.count, DOKLAD_FORMS)} v mesiaci ${monthLabel(upload.monthKey)}`)
              .join(", ")}
            . Zobrazia sa v ňom, keď sa začne.
          </span>
        </p>
      ) : null}
    </div>
  );
}
