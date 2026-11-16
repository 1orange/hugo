"use client";

import { useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { useDismiss } from "@/components/app/use-dismiss";
import { monthLabel } from "@/modules/format-sk";
import Link from "next/link";
import type { MonthExportPreview } from "@/lib/omega-export/service";
import {
  downloadOmegaExportAction,
  previewOmegaExportAction,
} from "./omega-export-actions";

/** A document of the month whose party failed integrity; the link selects it in the workbench. */
export type ExportIntegrityProblem = {
  documentId: string;
  label: string;
  fileName: string;
  href: string;
};

type OmegaExportPanelProps = {
  companyId: number;
  monthKey: string;
  integrityProblems: ExportIntegrityProblem[];
};

/** Slovak plural of "doklad": 1 doklad, 2 až 4 doklady, 5 a viac dokladov. */
function documentCountWord(count: number): string {
  if (count === 1) {
    return "doklad";
  }
  return count >= 2 && count <= 4 ? "doklady" : "dokladov";
}

/**
 * The month's export, a toolbar button. Its popover holds what she needs before
 * downloading — the parties that disagree with the register, the download — and
 * the preview, a list of every document of the month, opens as a sheet.
 */
export function OmegaExportPanel({ companyId, monthKey, integrityProblems }: OmegaExportPanelProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<MonthExportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const containerRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const sheetRef = useRef<HTMLDialogElement>(null);

  function loadPreview() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await previewOmegaExportAction({ companyId, monthKey });
        setPreview(next);
        setOpen(false);
        sheetRef.current?.showModal();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Náhľad zlyhal.");
      }
    });
  }

  function downloadFile() {
    setError(null);
    startTransition(async () => {
      const result = await downloadOmegaExportAction({ companyId, monthKey });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: "text/plain;charset=windows-1250" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      if (sheetRef.current?.open) {
        setPreview(await previewOmegaExportAction({ companyId, monthKey }));
      }
    });
  }

  const problems = integrityProblems.length;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="omega-export-button"
        className={`press inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium shadow-[0_0_0_1px_rgb(0_0_0/0.08)] ${
          open ? "bg-accent-soft" : "bg-surface hover:bg-surface-2"
        }`}
      >
        <Download aria-hidden className="size-[15px]" strokeWidth={1.9} />
        Export do Omegy
        {problems > 0 ? (
          <span
            className="tabular grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#f6c9c4] px-1.5 text-[11.5px] font-bold text-bad-strong"
            aria-label={`${problems} ${documentCountWord(problems)} na kontrolu`}
          >
            {problems}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          role="dialog"
          aria-label="Export do Omegy"
          data-testid="omega-export-panel"
          className="glass-strong pop-in absolute top-11 right-0 z-40 w-[400px] max-w-[calc(100vw-32px)] origin-top-right rounded-xl p-4 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.16)]"
        >
          <h2 className="text-[15px] font-semibold">Export do Omegy</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">Jeden súbor na mesiac — T04 partneri, T01 faktúry, T00 bločky.</p>

          {problems > 0 ? (
            <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong" data-testid="export-integrity-warning">
              <p>
                <strong className="font-semibold">
                  {problems} {documentCountWord(problems)} {problems === 1 ? "má" : "majú"} stranu, ktorá nesedí s
                  registrom.
                </strong>{" "}
                Export sa nezablokuje — skontroluj {problems === 1 ? "ho" : "ich"} pred stiahnutím.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {integrityProblems.map((problem) => (
                  <li key={problem.documentId}>
                    <Link
                      href={problem.href}
                      scroll={false}
                      onClick={() => setOpen(false)}
                      className="font-medium underline underline-offset-2"
                    >
                      {problem.label}
                    </Link>{" "}
                    <span className="text-bad">— {problem.fileName}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 text-[13px] text-bad" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={loadPreview}
              disabled={pending}
              className="press rounded-lg bg-fill px-3.5 py-1.5 text-[13.5px] font-medium disabled:opacity-50"
            >
              Náhľad…
            </button>
            <button
              type="button"
              onClick={downloadFile}
              disabled={pending}
              className="press rounded-lg bg-accent px-3.5 py-1.5 text-[13.5px] font-semibold text-white disabled:opacity-50"
            >
              Stiahnuť TXT
            </button>
          </div>
        </section>
      ) : null}

      <dialog
        ref={sheetRef}
        aria-labelledby="omega-export-sheet-title"
        data-testid="omega-export-preview"
        className="sheet-in m-auto mt-14 max-h-[calc(100vh-96px)] w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-2xl bg-surface p-0 text-ink shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_24px_70px_rgb(0_0_0/0.28)] backdrop:bg-black/25 open:flex open:flex-col"
      >
        <header className="px-5 pt-5 pb-3">
          <h2 id="omega-export-sheet-title" className="text-[20px] font-bold tracking-[-0.015em]">
            Náhľad exportu — {monthLabel(monthKey)}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            Do Omegy ide len to, čo je potvrdené. Ostatné sa zadrží a pôjde v ďalšom exporte, keď to rozhodneš.
          </p>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
          {problems > 0 ? (
            <p className="rounded-lg bg-bad-soft px-3 py-2.5 text-[13px] text-bad-strong">
              <strong className="font-semibold">
                {problems} {documentCountWord(problems)} {problems === 1 ? "má" : "majú"} stranu, ktorá nesedí s registrom.
              </strong>{" "}
              {problems === 1 ? "Ide" : "Idú"} do exportu — skontroluj {problems === 1 ? "ho" : "ich"} pred stiahnutím.
            </p>
          ) : null}
          <section>
            <h3 className="eyebrow mx-1 mb-1.5">V exporte · {preview?.included.length ?? 0}</h3>
            <div className="overflow-hidden rounded-xl bg-surface-2">
              {preview && preview.included.length > 0 ? (
                <ul>
                  {preview.included.map((row) => (
                    <li key={row.documentId} className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
                      <span className="tabular w-[84px] shrink-0 font-mono text-[12.5px] text-ink-3">{row.exportNumber ?? "—"}</span>
                      <span className="shrink-0 rounded-[5px] bg-accent-soft px-1.5 py-px text-[11.5px] font-bold text-accent">
                        {row.section}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      <span className="hidden max-w-[40%] truncate text-[12.5px] text-ink-3 sm:inline">{row.fileName}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-3 text-[13px] text-ink-3">Žiadne potvrdené doklady.</p>
              )}
            </div>
          </section>
          <section>
            <h3 className="eyebrow mx-1 mb-1.5">Zadržané · {preview?.heldBack.length ?? 0}</h3>
            <div className="overflow-hidden rounded-xl bg-surface-2">
              {preview && preview.heldBack.length > 0 ? (
                <ul>
                  {preview.heldBack.map((row) => (
                    <li key={row.documentId} className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
                      <span className="min-w-0 flex-1 truncate">{row.label || row.fileName}</span>
                      <span className="max-w-[55%] text-right text-[12.5px] text-ink-3">{row.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-3 text-[13px] text-ink-3">Nič sa nezadržiava.</p>
              )}
            </div>
          </section>
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3 shadow-[0_-1px_0_rgb(0_0_0/0.06)]">
          <button
            type="button"
            onClick={() => sheetRef.current?.close()}
            className="press rounded-lg bg-fill px-4 py-2 text-[13.5px] font-medium"
          >
            Zavrieť
          </button>
          <button
            type="button"
            onClick={downloadFile}
            disabled={pending}
            className="press rounded-lg bg-accent px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50"
          >
            Stiahnuť TXT
          </button>
        </footer>
      </dialog>
    </div>
  );
}
