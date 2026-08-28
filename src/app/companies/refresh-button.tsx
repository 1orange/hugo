"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { refreshSweepAction } from "./actions";

type RefreshButtonProps = {
  lastSweepAt: string | null;
};

export function RefreshButton({ lastSweepAt }: RefreshButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        data-testid="refresh-sweep"
        onClick={() => {
          startTransition(async () => {
            await refreshSweepAction();
            router.refresh();
          });
        }}
      >
        {pending ? "Refreshing…" : "Refresh"}
      </Button>
      <p
        className="text-xs text-muted-foreground"
        data-testid="last-sweep-at"
        data-sweep-at={lastSweepAt ?? ""}
      >
        {lastSweepAt
          ? `Last sweep: ${new Date(lastSweepAt).toLocaleString()}`
          : "No sweep yet"}
      </p>
    </div>
  );
}
