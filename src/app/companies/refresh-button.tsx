"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { refreshSweepAction } from "./actions";

/**
 * Forces a re-read of Drive. The freshness label lives in the app bar beside
 * it, so this stays a single small control rather than a stacked pair.
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      data-testid="refresh-sweep"
      className="rounded-md border border-line-2 bg-surface px-2.5 py-[3px] text-[11.5px] text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50"
      onClick={() => {
        startTransition(async () => {
          await refreshSweepAction();
          router.refresh();
        });
      }}
    >
      {pending ? "Obnovujem…" : "Obnoviť"}
    </button>
  );
}
