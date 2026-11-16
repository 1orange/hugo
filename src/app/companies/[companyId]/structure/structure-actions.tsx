"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  confirmFolderRenameAction,
  undoFolderRenameAction,
} from "../../actions";

/** Proposes the existing rename (ADR 0007) and confirms it through the same action the month screen uses. */
export function RepairButton({
  companyId,
  monthKey,
  driveFolderId,
  targetName,
  canRename,
  renameBlockedReason,
}: {
  companyId: number;
  monthKey: string;
  driveFolderId: string;
  targetName: string;
  canRename: boolean;
  renameBlockedReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmFolderRenameAction({
        companyId,
        monthKey,
        driveFolderId,
        targetName,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {canRename ? (
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          data-testid="structure-confirm-rename"
          className="w-fit rounded-md bg-warn px-3 py-1.5 text-[11.5px] font-semibold text-warn-soft disabled:opacity-50"
        >
          {pending ? "Premenúvam…" : `Premenovať na „${targetName}“`}
        </button>
      ) : null}
      {renameBlockedReason ? (
        <p className="text-[11.5px] text-bad">{renameBlockedReason}</p>
      ) : null}
      {error ? <p className="text-[11.5px] text-bad">{error}</p> : null}
    </div>
  );
}

/** Reverts a rename Hugo applied. Refuses in the action if the folder was renamed again since. */
export function UndoRenameButton({
  companyId,
  monthKey,
  mutationId,
}: {
  companyId: number;
  monthKey: string;
  mutationId: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onUndo() {
    setError(null);
    startTransition(async () => {
      const result = await undoFolderRenameAction({
        companyId,
        monthKey,
        mutationId,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onUndo}
        disabled={pending}
        data-testid="structure-undo-rename"
        className="w-fit rounded-md border border-line-2 bg-surface px-3 py-1.5 text-[11.5px] font-medium text-ink-2 disabled:opacity-50"
      >
        {pending ? "Vraciam…" : "Vrátiť premenovanie"}
      </button>
      {error ? <p className="text-[11.5px] text-bad">{error}</p> : null}
    </div>
  );
}
