import type { DocumentListItem } from "@/lib/documents/view";

/**
 * The right pane for a bank statement: its name and decision, and nothing to
 * fill in. A statement is listed and decided, never read (ADR 0013, amended
 * 2026-11-23), so there is no field form, note or re-read to offer here.
 */
export function StatementPanel({ document }: { document: DocumentListItem }) {
  const pill =
    document.decision === "confirmed"
      ? { label: "Potvrdené", className: "bg-good-soft text-good" }
      : document.decision === "not_relevant"
        ? { label: "Nerelevantné", className: "bg-fill text-ink-2" }
        : { label: "Čaká", className: "bg-accent-soft text-accent" };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-ground px-4 pt-4 pb-10"
      data-testid="statement-panel"
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Bankový výpis</p>
          <h2 className="mt-0.5 text-[18px] leading-tight font-bold tracking-[-0.015em] [overflow-wrap:anywhere]">
            {document.name}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{document.folderSlot}</p>
        </div>
        <span className={`mt-1 shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${pill.className}`}>
          {pill.label}
        </span>
      </div>

      <p className="rounded-xl bg-surface px-3.5 py-2.5 text-[13px] text-ink-2 shadow-[0_0_0_1px_rgb(0_0_0/0.04)]" data-testid="statement-notice">
        Výpis sa nečíta ani neposiela na spracovanie a zatiaľ sa neexportuje do Omegy. Hugo len eviduje, že
        prišiel. Kým ho nerozhodnete, počíta sa do úloh tohto mesiaca.
      </p>

      {document.decision === "not_relevant" ? (
        <p className="rounded-xl bg-surface px-3.5 py-2 text-[13px] text-ink-2 shadow-[0_0_0_1px_rgb(0_0_0/0.04)]">
          {document.notRelevantReason ? `Dôvod: ${document.notRelevantReason}` : "Dôvod nebol uvedený."}
        </p>
      ) : null}
    </div>
  );
}
