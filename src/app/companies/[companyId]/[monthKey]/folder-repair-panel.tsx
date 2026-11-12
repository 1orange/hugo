"use client";

import Link from "next/link";
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
    <div className="space-y-2 rounded-lg bg-surface p-3 text-[13px] shadow-[0_0_0_1px_rgb(0_0_0/0.06)]">
      {showRepairUi ? (
        <>
          <p className="font-semibold text-warn">
            {observedName}
            {kind === "repair-candidate" && proposedTargetName ? (
              <span className="block font-normal text-ink-3">→ {proposedTargetName}</span>
            ) : null}
          </p>
          <p className="text-[12.5px] text-ink-2">
            {kind === "repair-candidate"
              ? "Názov priečinka je blízky kanonickému, ale nie presný. Doklady v ňom sa nezobrazujú, kým sa neopraví."
              : "Tento priečinok nie je rozpoznaný. Ak patrí do štandardnej štruktúry mesiaca, vyber kanonický cieľ."}
          </p>
          <p className="text-[12px] text-ink-3">
            Premenovanie priečinka v Drive nerozbije odkazy klientov — ID súborov a
            priečinkov zostávajú rovnaké, takže skratky a zdieľané odkazy fungujú
            ďalej.
          </p>
        </>
      ) : (
        <p className="text-[12.5px] text-ink-3">
          <span className="block font-semibold text-ink">{observedName}</span>
          Tento priečinok premenovala aplikácia. Vrátenie obnoví predchádzajúci
          názov v Drive.
        </p>
      )}

      {renameBlockedReason ? (
        <p className="text-[12.5px] text-bad" data-testid="rename-blocked-warning">
          {renameBlockedReason}
        </p>
      ) : null}

      {kind === "unknown" ? (
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium text-ink-2">
            Správny názov
          </span>
          <select
            className="rounded-lg bg-fill px-2.5 py-1.5"
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
            className="press rounded-lg bg-accent-soft px-3 py-1.5 text-[12.5px] font-semibold text-accent disabled:opacity-50"
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
            className="press rounded-lg bg-fill px-3 py-1.5 text-[12.5px] font-medium text-ink disabled:opacity-50"
            onClick={onUndo}
            disabled={pending}
            data-testid="undo-folder-rename"
          >
            Vrátiť premenovanie
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-[12.5px] text-bad" data-testid="folder-repair-error">
          {error}
        </p>
      ) : null}

      <Link
        href={`/companies/${companyId}/structure`}
        className="inline-block text-[12.5px] font-medium text-accent hover:underline"
        data-testid="folder-repair-structure-link"
      >
        Štruktúra Drive pre túto firmu
      </Link>
    </div>
  );
}
