"use client";

import { useState, useTransition } from "react";
import {
  confirmFolderRenameAction,
  undoFolderRenameAction,
} from "../../actions";

type FolderRepairPanelProps = {
  companyId: number;
  monthKey: string;
  driveFolderId: string;
  observedName: string;
  proposedTargetName: string | null;
  kind: "repair-candidate" | "unknown" | "canonical";
  canRename: boolean;
  renameBlockedReason: string | null;
  activeMutationId: number | null;
  canonicalFolderNames: string[];
};

export function FolderRepairPanel({
  companyId,
  monthKey,
  driveFolderId,
  observedName,
  proposedTargetName,
  kind,
  canRename,
  renameBlockedReason,
  activeMutationId,
  canonicalFolderNames,
}: FolderRepairPanelProps) {
  const [pending, startTransition] = useTransition();
  const [manualTarget, setManualTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  const targetName =
    kind === "repair-candidate" ? proposedTargetName : manualTarget;
  const showRepairUi = kind === "repair-candidate" || kind === "unknown";
  const showUndoOnly = kind === "canonical" && activeMutationId !== null;

  if (!showRepairUi && !showUndoOnly) {
    return null;
  }

  function onConfirm() {
    if (!targetName) {
      return;
    }
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
      }
    });
  }

  function onUndo() {
    if (!activeMutationId) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await undoFolderRenameAction({
        companyId,
        monthKey,
        mutationId: activeMutationId,
      });
      if (!result.ok) {
        setError(result.message);
      }
    });
  }

  return (
    <div className="mb-4 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
      {showRepairUi ? (
        <>
          <p className="text-amber-950">
            {kind === "repair-candidate"
              ? "This folder name is close to a canonical slot but not exact. Documents here are hidden from canonical views until repaired."
              : "This folder is not recognised. Choose a canonical target if it belongs in the standard month structure."}
          </p>
          <p className="text-xs text-amber-900">
            Renaming a folder in Drive does not break your clients&apos; links —
            file and folder IDs stay the same, so shortcuts and shared links keep
            working.
          </p>
        </>
      ) : (
        <p className="text-xs text-amber-900">
          This folder was renamed by the app. Undo restores the previous name in
          Drive.
        </p>
      )}

      {renameBlockedReason ? (
        <p className="text-xs text-red-700" data-testid="rename-blocked-warning">
          {renameBlockedReason}
        </p>
      ) : null}

      {kind === "unknown" ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-950">
            Canonical target
          </span>
          <select
            className="rounded border border-amber-300 bg-white px-2 py-1"
            value={manualTarget}
            onChange={(event) => setManualTarget(event.target.value)}
            disabled={pending}
            data-testid="manual-canonical-select"
          >
            <option value="">Select a folder name…</option>
            {canonicalFolderNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {showRepairUi && canRename && targetName ? (
          <button
            type="button"
            className="rounded bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 disabled:opacity-50"
            onClick={onConfirm}
            disabled={pending}
            data-testid="confirm-folder-rename"
          >
            {pending ? "Renaming…" : `Rename to “${targetName}”`}
          </button>
        ) : null}
        {activeMutationId ? (
          <button
            type="button"
            className="rounded border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-950 disabled:opacity-50"
            onClick={onUndo}
            disabled={pending}
            data-testid="undo-folder-rename"
          >
            Undo rename
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-red-700" data-testid="folder-repair-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
