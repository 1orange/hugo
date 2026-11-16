"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshSweepAction } from "./actions";

/**
 * Reads Drive's changes now instead of waiting for the next sweep. An icon in
 * the app bar; it spins while the sweep runs.
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      data-testid="refresh-sweep"
      aria-label={pending ? "Obnovujem…" : "Obnoviť"}
      title="Obnoviť z Drive"
      className="press grid size-[34px] place-items-center rounded-lg text-ink-2 hover:bg-fill hover:text-ink disabled:text-ink-3"
      onClick={() => {
        startTransition(async () => {
          await refreshSweepAction();
          router.refresh();
        });
      }}
    >
      <RefreshCw
        aria-hidden
        className={`size-[17px] ${pending ? "animate-spin motion-reduce:animate-none" : ""}`}
        strokeWidth={1.9}
      />
    </button>
  );
}
