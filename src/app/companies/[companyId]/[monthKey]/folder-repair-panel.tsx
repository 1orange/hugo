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
    <div className="space-y-2.5 rounded-md border border-warn/30 bg-warn-soft p-2.5 text-[12.5px]">
      {showRepairUi ? (
        <>
          <p className="font-medium text-ink">
            {observedName}
          </p>
          <p className="text-ink-2">
            {kind === "repair-candidate"
              ? "Názov priečinka je blízky kanonickému, ale nie presný. Doklady v ňom sa nezobrazujú, kým sa neopraví."
              : "Tento priečinok nie je rozpoznaný. Ak patrí do štandardnej štruktúry mesiaca, vyber kanonický cieľ."}
          </p>
          <p className="text-[11.5px] text-ink-3">
            Premenovanie priečinka v Drive nerozbije odkazy klientov — ID súborov a
            priečinkov zostávajú rovnaké, takže skratky a zdieľané odkazy fungujú
            ďalej.
          </p>
        </>
      ) : (
        <p className="text-[11.5px] text-ink-3">
          Tento priečinok premenovala aplikácia. Vrátenie obnoví predchádzajúci
          názov v Drive.
        </p>
      )}

      {renameBlockedReason ? (
        <p className="text-[11.5px] text-bad" data-testid="rename-blocked-warning">
          {renameBlockedReason}
        </p>
      ) : null}

      {kind === "unknown" ? (
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-ink-2">
            Kanonický cieľ
          </span>
          <select
            className="rounded-md border border-line-2 bg-surface px-2 py-1"
            value={manualTarget}
            onChange={(event) => setManualTarget(event.target.value)}
            disabled={pending}
            data-testid="manual-canonical-select"
          >
            <option value="">Vyber názov priečinka…</option>
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
            className="rounded-md bg-warn px-3 py-1.5 text-[11.5px] font-semibold text-warn-soft disabled:opacity-50"
            onClick={onConfirm}
            disabled={pending}
            data-testid="confirm-folder-rename"
          >
            {pending ? "Premenúvam…" : `Premenovať na „${targetName}“`}
          </button>
        ) : null}
        {activeMutationId ? (
          <button
            type="button"
            className="rounded-md border border-line-2 bg-surface px-3 py-1.5 text-[11.5px] font-medium text-ink-2 disabled:opacity-50"
            onClick={onUndo}
            disabled={pending}
            data-testid="undo-folder-rename"
          >
            Vrátiť premenovanie
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-[11.5px] text-bad" data-testid="folder-repair-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
