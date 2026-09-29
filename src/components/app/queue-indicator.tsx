"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ExtractionQueueView } from "@/lib/extraction-queue/view";
import type { ServiceState } from "@/lib/extraction-queue/service-health";
import { useExtractionQueue } from "./use-extraction-queue";

const BLOCKING: readonly ServiceState[] = ["down", "unconfigured", "loading"];

/** The service documents wait for, when something is waiting for it. */
function blockedBy(view: ExtractionQueueView): string | null {
  if (!view.workerAlive) {
    return "Worker nebeží";
  }
  const pending = view.running.length + view.waiting.length + view.delayed.length > 0;
  if (!pending) {
    return null;
  }
  const { model, ocr } = view.services;
  if (BLOCKING.includes(model.state)) {
    return model.state === "loading" ? "Model sa načítava" : model.state === "unconfigured" ? "Model nenastavený" : "Model nedostupný";
  }
  if (BLOCKING.includes(ocr.state)) {
    return ocr.state === "unconfigured" ? "OCR nenastavené" : "OCR nedostupné";
  }
  return null;
}

/**
 * The extraction queue in the app bar, on every screen: what is being read
 * and how far, how much waits, or which service everything waits for.
 */
export function QueueIndicator() {
  const { view } = useExtractionQueue();
  const pathname = usePathname();
  // The queue page's "Späť" returns here.
  const href = pathname === "/queue" ? "/queue" : `/queue?from=${encodeURIComponent(pathname)}`;

  const base =
    "flex items-center gap-1.5 rounded-md border px-2.5 py-[3px] text-[11.5px] tabular-nums hover:border-accent hover:text-accent";

  if (!view) {
    return (
      <Link href={href} className={`${base} border-line-2 bg-surface text-ink-3`} data-testid="queue-indicator">
        Spracovanie
      </Link>
    );
  }

  const blocked = blockedBy(view);
  const current = view.running[0];
  const waiting = view.waiting.length;

  if (blocked) {
    return (
      <Link
        href={href}
        className={`${base} border-warn/40 bg-warn-soft text-warn`}
        data-testid="queue-indicator"
        title="Doklady čakajú na službu — podrobnosti v Spracovaní"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-warn" />
        {blocked}
        {waiting + view.running.length > 0 ? <span className="text-warn/80">· {waiting + view.running.length}</span> : null}
      </Link>
    );
  }

  if (current) {
    return (
      <Link
        href={href}
        className={`${base} border-accent/30 bg-accent-soft text-accent`}
        data-testid="queue-indicator"
        title={`${current.fileName} — ${current.stageLabel}`}
      >
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
        Číta sa · {current.percent} %
        {waiting > 0 ? <span className="text-accent/70">+{waiting} v rade</span> : null}
      </Link>
    );
  }

  return (
    <Link href={href} className={`${base} border-line-2 bg-surface text-ink-3`} data-testid="queue-indicator">
      Rad prázdny
    </Link>
  );
}
