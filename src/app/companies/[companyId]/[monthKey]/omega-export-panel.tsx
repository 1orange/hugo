"use client";

import { useState, useTransition } from "react";
import type { MonthExportPreview } from "@/lib/omega-export/service";
import {
  downloadOmegaExportAction,
  previewOmegaExportAction,
} from "./omega-export-actions";

type OmegaExportPanelProps = {
  companyId: number;
  monthKey: string;
};

export function OmegaExportPanel({ companyId, monthKey }: OmegaExportPanelProps) {
  const [preview, setPreview] = useState<MonthExportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadPreview() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await previewOmegaExportAction({ companyId, monthKey });
        setPreview(next);
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
      const nextPreview = await previewOmegaExportAction({ companyId, monthKey });
      setPreview(nextPreview);
    });
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <div>
          <h2 className="text-[14px] font-semibold">Export do Omega</h2>
          <p className="text-[12px] text-ink-2">
            Jeden súbor na mesiac — T04 partneri, T01 faktúry, T00 bločky.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadPreview}
            disabled={pending}
            className="rounded-md border border-line-2 px-3 py-1.5 text-[12px] hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Náhľad
          </button>
          <button
            type="button"
            onClick={downloadFile}
            disabled={pending}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] text-white hover:opacity-90 disabled:opacity-50"
          >
            Stiahnuť TXT
          </button>
        </div>
      </header>

      {error ? <p className="px-3.5 py-2 text-[12px] text-danger">{error}</p> : null}

      {preview ? (
        <div className="grid gap-3 px-3.5 py-3 md:grid-cols-2">
          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">
              V exporte ({preview.included.length})
            </h3>
            <ul className="mt-1 space-y-1 text-[12px]">
              {preview.included.length === 0 ? (
                <li className="text-ink-2">Žiadne potvrdené doklady.</li>
              ) : (
                preview.included.map((row) => (
                  <li key={row.driveFileId}>
                    <span className="font-mono">{row.exportNumber}</span>{" "}
                    <span className="text-ink-2">[{row.section}]</span> — {row.fileName}{" "}
                    <span className="text-ink-2">{row.label}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">
              Zadržané ({preview.heldBack.length})
            </h3>
            <ul className="mt-1 space-y-1 text-[12px]">
              {preview.heldBack.length === 0 ? (
                <li className="text-ink-2">—</li>
              ) : (
                preview.heldBack.map((row) => (
                  <li key={row.driveFileId}>
                    {row.fileName}: {row.reason}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
