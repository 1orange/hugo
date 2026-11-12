"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  moveLateArrivalsAction,
  setLateArrivalIgnoredAction,
  undoLateArrivalMoveAction,
} from "../../actions";
import type { LateArrivalItem, LateArrivalsView } from "@/lib/late-arrivals/service";
import { countWithNoun, DOKLAD_FORMS } from "@/modules/format-sk";

type LateArrivalsPanelProps = {
  companyId: number;
  /** The month on screen. */
  monthKey: string;
  /** Whether that month is the open one, where late arrivals are moved to. */
  isOpenMonth: boolean;
  view: LateArrivalsView;
};

/**
 * Documents that arrived in a closed month after its close (ADR 0005, ADR 0006).
 * On the open month: the proposed moves, confirmed in one click, and the
 * warnings; each can be ignored, each move undone. On a closed month: a note
 * that what arrived late here is waiting in the open month.
 */
export function LateArrivalsPanel({ companyId, monthKey, isOpenMonth, view }: LateArrivalsPanelProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "bad" | "good"; text: string } | null>(null);

  if (!isOpenMonth) {
    const here = view.pending.filter((item) => item.sourceMonthKey === monthKey);
    if (here.length === 0) {
      return null;
    }
    return (
      <p
        className="flex flex-wrap items-center gap-x-2 border-b border-line bg-warn-soft px-4 py-2 text-[13px] text-warn-strong sm:px-6"
        data-testid="late-arrivals-source-note"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-warn-dot" />
        <span>
          <b>
            Po uzavretí sem {arrivedVerb(here.length)} {countWithNoun(here.length, DOKLAD_FORMS)}.
          </b>{" "}
          {view.openMonthKey ? (
            <>
              Presunúť ich môžeš v otvorenom mesiaci{" "}
              <Link className="font-semibold underline underline-offset-2" href={`/companies/${companyId}/${view.openMonthKey}`}>
                {view.openMonthKey}
              </Link>
              .
            </>
          ) : (
            "Nie je otvorený žiadny mesiac, do ktorého by sa presunuli."
          )}
        </span>
      </p>
    );
  }

  if (view.pending.length === 0 && view.moved.length === 0) {
    return null;
  }

  function run(action: () => Promise<{ ok: true; moved?: number; failed?: Array<{ name: string; message: string }> } | { ok: false; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ tone: "bad", text: result.message });
        return;
      }
      if (result.failed && result.failed.length > 0) {
        setMessage({
          tone: "bad",
          text: result.failed.map((failure) => `${failure.name}: ${failure.message}`).join(" · "),
        });
      } else if (result.moved !== undefined) {
        setMessage({ tone: "good", text: `Presunuté: ${countWithNoun(result.moved, DOKLAD_FORMS)}.` });
      }
    });
  }

  const proposals = view.pending.filter((item) => item.assessment?.kind === "move");
  const warnings = view.pending.filter((item) => item.assessment?.kind === "warning");

  return (
    <section className="border-b border-line bg-warn-soft px-4 py-3 sm:px-6" data-testid="late-arrivals">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[14px] font-semibold text-warn-strong">
          Neskoro doručené doklady
          {view.pending.length > 0 ? ` · ${view.pending.length}` : ""}
        </h3>
        <span className="text-[13px] text-warn-strong/80">
          Prišli do uzavretého mesiaca po jeho uzavretí. Presunú sa sem, do {monthKey}, do priečinka s rovnakým
          názvom.
        </span>
        <div className="flex-1" />
        {view.movableCount > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => moveLateArrivalsAction({ companyId }))}
            data-testid="late-arrivals-move-all"
            className="press rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Presúvam…" : `Presunúť do ${monthKey} (${view.movableCount})`}
          </button>
        ) : null}
      </div>

      {message ? (
        <p
          role={message.tone === "bad" ? "alert" : "status"}
          data-testid="late-arrivals-message"
          className={`mt-2 text-[13px] ${message.tone === "bad" ? "text-bad" : "text-good"}`}
        >
          {message.text}
        </p>
      ) : null}

      {proposals.length + warnings.length > 0 ? (
        <ul className="mt-2.5 overflow-hidden rounded-xl bg-surface shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
          {[...proposals, ...warnings].map((item) => (
            <LateArrivalRow
              key={item.id}
              item={item}
              monthKey={monthKey}
              disabled={pending}
              onIgnore={() => run(() => setLateArrivalIgnoredAction({ companyId, lateArrivalId: item.id, ignored: true }))}
            />
          ))}
        </ul>
      ) : null}

      {view.moved.length > 0 ? (
        <details className="mt-2" data-testid="late-arrivals-moved">
          <summary className="cursor-pointer text-[13px] font-medium text-warn-strong">
            Presunuté ({view.moved.length}) — dá sa vrátiť
          </summary>
          <ul className="mt-2 overflow-hidden rounded-xl bg-surface shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
            {view.moved.map((item) => (
              <li
                key={item.id}
                data-testid={`late-arrival-moved-${item.driveFileId}`}
                className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5 text-[13px] first:border-t-0"
              >
                <span className="font-medium text-ink">{item.name}</span>
                <span className="text-ink-3">
                  z {item.sourceMonthKey} · {item.folderSlot}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={pending || !item.canUndo}
                  title={item.canUndo ? "Vrátiť doklad späť do uzavretého mesiaca" : "Presun sa už nedá vrátiť"}
                  onClick={() => run(() => undoLateArrivalMoveAction({ companyId, lateArrivalId: item.id }))}
                  data-testid={`late-arrival-undo-${item.driveFileId}`}
                  className="press rounded-lg bg-fill px-2.5 py-1 text-[12.5px] font-medium text-ink disabled:opacity-40"
                >
                  Vrátiť
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** "prišiel 1 doklad", "prišli 2 doklady", "prišlo 5 dokladov". */
function arrivedVerb(count: number): string {
  if (count === 1) {
    return "prišiel";
  }
  return count >= 2 && count <= 4 ? "prišli" : "prišlo";
}

function LateArrivalRow({
  item,
  monthKey,
  disabled,
  onIgnore,
}: {
  item: LateArrivalItem;
  monthKey: string;
  disabled: boolean;
  onIgnore: () => void;
}) {
  const proposed = item.assessment?.kind === "move";
  return (
    <li
      data-testid={`late-arrival-${item.driveFileId}`}
      data-kind={proposed ? "move" : "warning"}
      className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5 text-[13px] first:border-t-0"
    >
      <span className="font-medium text-ink">{item.name}</span>
      <span className="text-ink-3">
        {item.sourceMonthKey} · {item.folderSlot}
      </span>
      {proposed ? (
        <span className="text-accent">→ {monthKey}</span>
      ) : (
        <span className="basis-full text-[12.5px] text-warn" data-testid={`late-arrival-warning-${item.driveFileId}`}>
          {item.warning}
        </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        disabled={disabled}
        onClick={onIgnore}
        title="Odstrániť zo zoznamu (napríklad duplicitné nahratie). V Drive sa nič nezmení."
        data-testid={`late-arrival-ignore-${item.driveFileId}`}
        className="press rounded-lg bg-fill px-2.5 py-1 text-[12.5px] font-medium text-ink disabled:opacity-40"
      >
        Ignorovať
      </button>
    </li>
  );
}
