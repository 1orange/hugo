"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { MonthExportPreview } from "@/lib/omega-export/service";
import {
  downloadOmegaExportAction,
  previewOmegaExportAction,
} from "./omega-export-actions";

type OmegaExportPanelProps = {
  companyId: number;
  monthKey: string;
};

const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 80;
const KEYBOARD_STEP = 24;
const HEIGHT_KEY = "hugo.exportPreview.height";
const COLLAPSED_KEY = "hugo.exportPreview.collapsed";

/** At most most of the window: the workbench above keeps a strip of its own. */
function maxHeight(): number {
  return Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.7));
}

function clampHeight(height: number): number {
  return Math.min(Math.max(Math.round(height), MIN_HEIGHT), maxHeight());
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window keeps nothing; the panel still works.
  }
}

/**
 * The month's export, below the workbench. The preview lists every document
 * of the month, and on a laptop it took the screen the workbench needs: it
 * folds away to its header, and its top edge drags to the height she wants,
 * both remembered in this browser.
 */
export function OmegaExportPanel({ companyId, monthKey }: OmegaExportPanelProps) {
  const [preview, setPreview] = useState<MonthExportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    const storedHeight = Number(readStored(HEIGHT_KEY));
    if (storedHeight > 0) {
      setHeight(clampHeight(storedHeight));
    }
    setCollapsed(readStored(COLLAPSED_KEY) === "true");
  }, []);

  function resize(next: number) {
    const clamped = clampHeight(next);
    setHeight(clamped);
    store(HEIGHT_KEY, String(clamped));
  }

  function setFolded(folded: boolean) {
    setCollapsed(folded);
    store(COLLAPSED_KEY, String(folded));
  }

  function loadPreview() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await previewOmegaExportAction({ companyId, monthKey });
        setPreview(next);
        // Asking for the preview is asking to see it.
        setFolded(false);
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

  const expanded = preview !== null && !collapsed;

  return (
    <section className="rounded-lg border border-line bg-surface" data-testid="omega-export-panel">
      {expanded ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Výška náhľadu exportu"
          aria-valuemin={MIN_HEIGHT}
          aria-valuenow={height}
          tabIndex={0}
          title="Ťahaj pre zmenu výšky · dvojklik vráti pôvodnú"
          data-testid="omega-export-resize"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { startY: event.clientY, startHeight: height };
          }}
          onPointerMove={(event) => {
            if (drag.current) {
              // The panel sits at the bottom: dragging up makes it taller.
              resize(drag.current.startHeight + drag.current.startY - event.clientY);
            }
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onDoubleClick={() => resize(DEFAULT_HEIGHT)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              resize(height + KEYBOARD_STEP);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              resize(height - KEYBOARD_STEP);
            }
          }}
          className="group flex h-2.5 cursor-row-resize touch-none items-center justify-center rounded-t-lg hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none"
        >
          <span aria-hidden className="h-[3px] w-10 rounded-full bg-line-2 group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>
      ) : null}
      <header
        className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 ${expanded || error ? "border-b border-line" : ""}`}
      >
        <div>
          <h2 className="text-[14px] font-semibold">Export do Omega</h2>
          <p className="text-[12px] text-ink-2">
            Jeden súbor na mesiac — T04 partneri, T01 faktúry, T00 bločky.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {preview ? (
            <button
              type="button"
              onClick={() => setFolded(!collapsed)}
              aria-expanded={expanded}
              aria-controls="omega-export-preview"
              data-testid="omega-export-toggle"
              className="rounded-md px-2.5 py-1.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-accent"
            >
              {collapsed
                ? `Zobraziť náhľad (${preview.included.length + preview.heldBack.length})`
                : "Skryť náhľad"}
            </button>
          ) : null}
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

      {error ? <p className="px-3.5 py-2 text-[12px] text-bad">{error}</p> : null}

      {preview && expanded ? (
        <div
          id="omega-export-preview"
          className="grid content-start gap-3 overflow-y-auto px-3.5 py-3 md:grid-cols-2"
          style={{ height }}
          data-testid="omega-export-preview"
        >
          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">
              V exporte ({preview.included.length})
            </h3>
            <ul className="mt-1 space-y-1 text-[12px]">
              {preview.included.length === 0 ? (
                <li className="text-ink-2">Žiadne potvrdené doklady.</li>
              ) : (
                preview.included.map((row) => (
                  <li key={row.documentId}>
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
                  <li key={row.documentId}>
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
