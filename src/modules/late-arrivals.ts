/**
 * Late arrivals (ADR 0005, ADR 0006, amended 2026-11-12): a file that arrived
 * in a month after the month was closed. She closed the month without it, so
 * left where it is it would never be seen again. These rules are pure: the
 * sweep keeps the log with them, and the screen asks them what to propose.
 */

export type LateArrivalStatus = "pending" | "moved" | "ignored" | "resolved";

export const LATE_ARRIVAL_STATUSES: readonly LateArrivalStatus[] = ["pending", "moved", "ignored", "resolved"];

/** A stored file, as far as lateness is concerned. */
export type LateArrivalFile = {
  driveFileId: string;
  monthKey: string;
  /** The numbered folder it is in; null at the month root (the VAT PDFs) and elsewhere. */
  folderSlot: string | null;
  parentId: string;
  deleted: boolean;
  firstSeenAt: string;
  /** Moved here from another month at; null or absent when here since first seen. */
  arrivedAt?: string | null;
};

/** When the file arrived in the month it is in: moved there, or first seen there. */
export function arrivalTimeOf(file: Pick<LateArrivalFile, "arrivedAt" | "firstSeenAt">): string {
  return file.arrivedAt ?? file.firstSeenAt;
}

/**
 * Late: in a numbered folder of a closed month, arrived after the close.
 * Arrival is Hugo's own clock (first seen, or moved in from another month),
 * not Drive's `createdTime`: a client's copy carries any creation time, and a
 * file uploaded just before the close but swept just after it was not in the
 * month she closed either.
 */
export function isLateArrival(file: LateArrivalFile, closedAt: string | null | undefined): boolean {
  if (!closedAt || file.deleted || file.folderSlot === null) {
    return false;
  }
  return Date.parse(arrivalTimeOf(file)) > Date.parse(closedAt);
}

/** A log entry, as far as the sweep's bookkeeping is concerned. */
export type LateArrivalEntry = {
  id: number;
  driveFileId: string;
  status: LateArrivalStatus;
  sourceMonthKey: string;
  folderSlot: string;
  sourceParentId: string;
  detectedAt: string;
  statusChangedAt: string | null;
};

export type DetectedLateArrival = {
  driveFileId: string;
  sourceMonthKey: string;
  folderSlot: string;
  sourceParentId: string;
  arrivedAt: string;
};

export type LateArrivalSyncPlan = {
  /** New entries, or entries (re)opened as pending with where the file is now. */
  detected: DetectedLateArrival[];
  /** Pending entries whose file is late no more: gone, moved out, or its month reopened. */
  resolved: number[];
};

/**
 * What a sweep changes in the log. A late file without an entry is logged; a
 * pending entry follows its file between closed months. An entry she ignored,
 * or one moved or resolved, stays as it is unless the file arrived again after
 * that (a client put it back into a closed month). A pending entry whose file
 * is no longer late is resolved.
 */
export function planLateArrivalSync(input: {
  files: readonly LateArrivalFile[];
  closedAtByMonth: ReadonlyMap<string, string>;
  entries: readonly LateArrivalEntry[];
}): LateArrivalSyncPlan {
  const entryByFile = new Map(input.entries.map((entry) => [entry.driveFileId, entry]));
  const lateFiles = new Set<string>();
  const detected: DetectedLateArrival[] = [];

  for (const file of input.files) {
    if (!isLateArrival(file, input.closedAtByMonth.get(file.monthKey))) {
      continue;
    }
    lateFiles.add(file.driveFileId);
    const arrivedAt = arrivalTimeOf(file);
    const place = {
      driveFileId: file.driveFileId,
      sourceMonthKey: file.monthKey,
      folderSlot: file.folderSlot!,
      sourceParentId: file.parentId,
      arrivedAt,
    };
    const entry = entryByFile.get(file.driveFileId);
    if (!entry) {
      detected.push(place);
      continue;
    }
    if (entry.status === "pending") {
      const moved =
        entry.sourceMonthKey !== place.sourceMonthKey ||
        entry.folderSlot !== place.folderSlot ||
        entry.sourceParentId !== place.sourceParentId;
      if (moved) {
        detected.push(place);
      }
      continue;
    }
    const settledAt = entry.statusChangedAt ?? entry.detectedAt;
    if (Date.parse(arrivedAt) > Date.parse(settledAt)) {
      detected.push(place);
    }
  }

  const resolved = input.entries
    .filter((entry) => entry.status === "pending" && !lateFiles.has(entry.driveFileId))
    .map((entry) => entry.id);
  return { detected, resolved };
}

/** A folder of the open month a late arrival may be moved into. */
export type DestinationFolder = { name: string; driveFolderId: string };

export type LateArrivalAssessment =
  /** Proposed: into the open month, the folder of the same name. */
  | { kind: "move"; targetMonthKey: string; targetFolderId: string }
  /** A folder whose documents belong to their period: a bank statement, payroll, issued invoices. */
  | { kind: "warning"; reason: "not-movable-folder" }
  /** No month is open to move it into. */
  | { kind: "warning"; reason: "no-open-month" }
  /** The open month has no folder of that name; Hugo does not create it (ADR 0006, amended 2026-11-11). */
  | { kind: "warning"; reason: "missing-destination"; targetMonthKey: string }
  /** Drive says the file cannot be moved (`canMoveItemWithinDrive`). */
  | { kind: "warning"; reason: "cannot-move" };

/**
 * What to propose for a pending late arrival. Which folders move is
 * configuration: by default `02`, `04`, `05` and `06` (ADR 0006).
 */
export function assessLateArrival(input: {
  folderSlot: string;
  canMove: boolean;
  movableFolderNames: readonly string[];
  openMonthKey: string | null;
  destinationFolders: readonly DestinationFolder[];
}): LateArrivalAssessment {
  if (!input.movableFolderNames.includes(input.folderSlot)) {
    return { kind: "warning", reason: "not-movable-folder" };
  }
  if (!input.openMonthKey) {
    return { kind: "warning", reason: "no-open-month" };
  }
  const destination = input.destinationFolders.find((folder) => folder.name === input.folderSlot);
  if (!destination) {
    return { kind: "warning", reason: "missing-destination", targetMonthKey: input.openMonthKey };
  }
  if (!input.canMove) {
    return { kind: "warning", reason: "cannot-move" };
  }
  return { kind: "move", targetMonthKey: input.openMonthKey, targetFolderId: destination.driveFolderId };
}

/** The warning in Slovak, as the screen shows it. */
export function lateArrivalWarningText(assessment: Exclude<LateArrivalAssessment, { kind: "move" }>, folderSlot: string): string {
  switch (assessment.reason) {
    case "not-movable-folder":
      return `Priečinok „${folderSlot}“ patrí k svojmu obdobiu — doklad sa nepresúva. Skontroluj ho v uzavretom mesiaci.`;
    case "no-open-month":
      return "Nie je otvorený žiadny mesiac, do ktorého by sa doklad presunul.";
    case "missing-destination":
      return `Mesiac ${assessment.targetMonthKey} nemá priečinok „${folderSlot}“. Vytvor ho v Drive a doklad sa ponúkne na presun.`;
    case "cannot-move":
      return "Drive nedovoľuje doklad presunúť (súbor patrí klientovi alebo má obmedzené práva).";
  }
}
