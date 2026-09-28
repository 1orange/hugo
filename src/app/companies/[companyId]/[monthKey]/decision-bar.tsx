"use client";

import { useEffect, useRef, useState } from "react";
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
 * The decision is the loudest thing on the screen and sits directly under the
 * preview, in the path her eye already travels. Confirm is filled in the same
 * green the confirmed state uses in the list, so the button and the resulting
 * chip are visibly the same fact.
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
    <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
      <button
        type="button"
        onClick={() => onStep(-1)}
        className="rounded-md border border-line-2 bg-surface px-2 py-[3px] hover:border-accent hover:text-accent"
        title="Predchádzajúci doklad (K)"
      >
        ‹ K
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        className="rounded-md border border-line-2 bg-surface px-2 py-[3px] hover:border-accent hover:text-accent"
        title="Ďalší doklad (J)"
      >
        J ›
      </button>
    </span>
  );

  return (
    <div className="shrink-0 border-t border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
        {readOnly ? (
          <>
            <DecisionChip document={document} />
            <div className="flex-1" />
            <span className="text-[11.5px] text-ink-3">
              Mesiac je uzavretý — len na čítanie
            </span>
          </>
        ) : document.decision === null ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              data-testid={`document-confirm-${document.id}`}
              className="inline-flex items-center gap-2 rounded-md bg-good px-[15px] py-2 text-[13px] font-semibold text-good-ink hover:brightness-110 disabled:opacity-40"
            >
              ✓ Potvrdiť
              <kbd className="rounded-[3px] border border-current px-1 font-mono text-[10px] font-normal opacity-60">
                C
              </kbd>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onOpenDismiss}
              data-testid={`document-dismiss-${document.id}`}
              className="inline-flex items-center gap-2 rounded-md border border-line-2 bg-surface px-[15px] py-2 text-[13px] text-ink-2 hover:border-bad hover:text-bad disabled:opacity-40"
            >
              Nerelevantné
              <kbd className="rounded-[3px] border border-current px-1 font-mono text-[10px] opacity-60">
                N
              </kbd>
            </button>
            <div className="flex-1" />
            <span className="text-[11.5px] text-ink-3" data-testid="remaining-count">
              {awaitingNote}
            </span>
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
              className="text-[12.5px] text-accent underline underline-offset-2 disabled:opacity-40"
            >
              Vrátiť
            </button>
            <div className="flex-1" />
            <span className="text-[11.5px] text-ink-3" data-testid="remaining-count">
              {awaitingNote}
            </span>
            {stepper}
          </>
        )}
      </div>

      {dismissOpen && !readOnly ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5">
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
            placeholder="Prečo je nerelevantný? (nepovinné)"
            aria-label="Dôvod nerelevantnosti"
            data-testid={`dismiss-reason-${document.id}`}
            className="min-w-0 flex-1 rounded-md border border-line-2 bg-surface-2 px-2.5 py-1.5 text-[12.5px]"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => onDismiss(reason)}
            data-testid="dismiss-confirm"
            className="rounded-md border border-line-2 bg-surface px-[15px] py-1.5 text-[12.5px] text-ink-2 hover:border-bad hover:text-bad disabled:opacity-40"
          >
            Uložiť a pokračovať
          </button>
          <button
            type="button"
            onClick={onCloseDismiss}
            className="text-[12.5px] text-accent underline underline-offset-2"
          >
            Zrušiť
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DecisionChip({ document }: { document: DocumentListItem }) {
  const confirmed = document.decision === "confirmed";

  if (document.decision === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-[3px] text-[12px] text-ink-3">
        Bez rozhodnutia
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-semibold ${
          confirmed ? "bg-good-soft text-good" : "bg-surface-2 text-ink-3"
        }`}
        data-testid="decision-chip"
      >
        {confirmed ? "✓ Potvrdené" : "– Nerelevantné"}
      </span>
      {document.decidedAt ? (
        <span className="text-[11.5px] text-ink-3">
          {formatDateTime(document.decidedAt)}
        </span>
      ) : null}
      {document.notRelevantReason ? (
        <span className="text-[11.5px] text-ink-3">
          „{document.notRelevantReason}“
        </span>
      ) : null}
    </span>
  );
}
