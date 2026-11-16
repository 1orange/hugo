"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { DocumentListItem } from "@/lib/documents/view";
import { awaitingPhrase, formatDateTime } from "@/modules/format-sk";

type DecisionBarProps = {
  document: DocumentListItem | null;
  awaitingCount: number;
  readOnly: boolean;
  pending: boolean;
  onConfirm: () => void;
  onDismiss: (reason: string) => void;
  onUndo: () => void;
  onStep: (delta: number) => void;
  dismissOpen: boolean;
  onOpenDismiss: () => void;
  onCloseDismiss: () => void;
};

/**
 * The decision floats over the bottom of the preview, in the path her eye
 * already travels, on a translucent bar that keeps the document visible behind
 * it. Confirm is filled in the same green the confirmed state uses in the list.
 * "Nerelevantné…" asks why, with the common reasons one tap away.
 */
export function DecisionBar({
  document,
  awaitingCount,
  readOnly,
  pending,
  onConfirm,
  onDismiss,
  onUndo,
  onStep,
  dismissOpen,
  onOpenDismiss,
  onCloseDismiss,
}: DecisionBarProps) {
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLInputElement>(null);
  const documentId = document?.id;

  useEffect(() => {
    if (dismissOpen) {
      reasonRef.current?.focus();
    } else {
      setReason("");
    }
  }, [dismissOpen, documentId]);

  if (!document) {
    return null;
  }

  const awaitingNote = awaitingPhrase(awaitingCount);

  const stepper = (
    <>
      <span aria-hidden className="mx-0.5 h-[22px] w-px bg-black/10" />
      <button
        type="button"
        onClick={() => onStep(-1)}
        aria-label="Predchádzajúci doklad (K)"
        title="Predchádzajúci doklad (K)"
        className="press grid size-[34px] place-items-center rounded-[10px] text-ink-2 hover:bg-fill"
      >
        <ChevronUp aria-hidden className="size-4" strokeWidth={2.2} />
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        aria-label="Ďalší doklad (J)"
        title="Ďalší doklad (J)"
        className="press grid size-[34px] place-items-center rounded-[10px] text-ink-2 hover:bg-fill"
      >
        <ChevronDown aria-hidden className="size-4" strokeWidth={2.2} />
      </button>
      <span className="tabular pr-1.5 text-[12.5px] whitespace-nowrap text-ink-3" data-testid="remaining-count">
        {awaitingNote}
      </span>
    </>
  );

  const showReason = dismissOpen && !readOnly && document.decision === null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex flex-col items-center gap-2 px-4">
      {showReason ? (
        <div className="glass-strong rise-in pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-xl px-2.5 py-2 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_8px_24px_rgb(0_0_0/0.12)]">
          <span className="mr-0.5 text-[12.5px] text-ink-3">Častý dôvod:</span>
          {REASON_PICKS.map((pick) => (
            <button
              key={pick}
              type="button"
              aria-pressed={reason === pick}
              onClick={() => {
                setReason(pick);
                reasonRef.current?.focus();
              }}
              className={`press rounded-full px-2.5 py-1 text-[12.5px] ${
                reason === pick ? "bg-ink text-white" : "bg-fill text-ink hover:bg-fill-2"
              }`}
            >
              {pick}
            </button>
          ))}
        </div>
      ) : null}

      <div className="glass pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl p-2 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_8px_30px_rgb(0_0_0/0.14)]">
        {readOnly ? (
          <>
            <DecisionChip document={document} />
            <span className="px-2 text-[13px] text-ink-3">Mesiac je uzavretý — len na čítanie</span>
          </>
        ) : showReason ? (
          <>
            <label className="flex items-center gap-2 pl-2">
              <span className="text-[13.5px] font-semibold whitespace-nowrap">Prečo nerelevantné?</span>
              <input
                ref={reasonRef}
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onDismiss(reason);
                  }
                  if (event.key === "Escape") {
                    onCloseDismiss();
                  }
                }}
                placeholder="Dôvod — nepovinný"
                aria-label="Dôvod nerelevantnosti"
                data-testid={`dismiss-reason-${document.id}`}
                className="w-[260px] max-w-[50vw] rounded-[9px] bg-fill px-2.5 py-2 text-[13.5px] outline-none placeholder:text-ink-4 focus:bg-surface focus:shadow-[0_0_0_2px_rgb(43_93_114/0.45)]"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => onDismiss(reason)}
              data-testid="dismiss-confirm"
              className="press rounded-[10px] bg-ink px-3.5 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50"
            >
              Označiť
            </button>
            <button
              type="button"
              onClick={onCloseDismiss}
              className="press rounded-[10px] px-3 py-2 text-[13.5px] font-medium text-ink-2 hover:bg-fill"
            >
              Zrušiť
            </button>
          </>
        ) : document.decision === null ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              data-testid={`document-confirm-${document.id}`}
              className="press inline-flex items-center gap-2 rounded-[10px] bg-good px-4 py-2 text-[14px] font-semibold text-white shadow-[0_1px_2px_rgb(0_0_0/0.15)] hover:brightness-110 disabled:opacity-50"
            >
              <Check aria-hidden className="size-4" strokeWidth={2.6} />
              Potvrdiť
              <kbd className="rounded-[4px] bg-white/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold">C</kbd>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onOpenDismiss}
              data-testid={`document-dismiss-${document.id}`}
              className="press inline-flex items-center gap-2 rounded-[10px] bg-fill px-3.5 py-2 text-[14px] font-medium text-ink hover:bg-fill-2 disabled:opacity-50"
            >
              Nerelevantné…
              <kbd className="rounded-[4px] bg-fill-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-2">N</kbd>
            </button>
            {stepper}
          </>
        ) : (
          <>
            <DecisionChip document={document} />
            <button
              type="button"
              disabled={pending}
              onClick={onUndo}
              data-testid={`document-undo-${document.id}`}
              className="press rounded-[10px] bg-fill px-3 py-2 text-[13.5px] font-medium text-ink hover:bg-fill-2 disabled:opacity-50"
            >
              Zmeniť
            </button>
            {stepper}
          </>
        )}
      </div>
    </div>
  );
}

/** What she most often writes; one tap fills the field, which she can still edit. */
const REASON_PICKS = ["Súkromný výdavok", "Duplikát", "Patrí inej firme", "Nie je účtovný doklad"];

function DecisionChip({ document }: { document: DocumentListItem }) {
  const confirmed = document.decision === "confirmed";

  if (document.decision === null) {
    return <span className="px-2 text-[13px] text-ink-3">Bez rozhodnutia</span>;
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 px-1.5">
      <span
        className={`inline-flex items-center gap-1.5 text-[13.5px] font-semibold ${confirmed ? "text-good" : "text-ink-2"}`}
        data-testid="decision-chip"
      >
        {confirmed ? "✓ Potvrdené" : "– Nerelevantné"}
      </span>
      {document.decidedAt ? (
        <span className="text-[12.5px] text-ink-3">{formatDateTime(document.decidedAt)}</span>
      ) : null}
    </span>
  );
}
