import { uploadedAfterMonthWasBooked } from "./month-lifecycle";

/**
 * Late arrivals (ADR 0005, ADR 0006, amended 2026-11-12 and 2026-11-24): a file
 * that arrived in a month after the month was closed, or was uploaded into it
 * after the month stopped being booked. She closed the month without it, so
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
  /** When the file was uploaded to Drive: survives a rebuilt database, unlike firstSeenAt. */
  driveCreatedTime?: string;
  /** The file's calendar month (`YYYY_MM`) when `monthKey` is keyed by company too. */
  period?: string;
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

/**
 * When a file came into its month, for the booking-month rule: moved there (a
 * sweep saw it), else uploaded to Drive. Never firstSeenAt, which a rebuilt
 * database sets to today for every file.
 */
export function uploadTimeOf(file: Pick<LateArrivalFile, "arrivedAt" | "driveCreatedTime">): string | null {
  return file.arrivedAt ?? file.driveCreatedTime ?? null;
}

/**
 * A file uploaded into a month after that month stopped being booked (ADR 0006,
 * amended 2026-11-24): from November, anything put into September or earlier.
 * Only uploads since `since` count, the moment the rule was first applied, so
 * the drive's history is not proposed all at once.
 */
export function isPassedMonthArrival(file: LateArrivalFile, since: string | null | undefined): boolean {
  if (!since || file.deleted || file.folderSlot === null) {
    return false;
  }
  const uploadedAt = uploadTimeOf(file);
  if (!uploadedAt || Date.parse(uploadedAt) < Date.parse(since)) {
    return false;
  }
  return uploadedAfterMonthWasBooked(file.period ?? file.monthKey, uploadedAt);
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
  /** Where a moved entry's file was moved to (`YYYY_MM`). */
  targetMonthKey?: string | null;
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
  /** Uploads since then into a month no longer booked are late too; null turns that rule off. */
  passedMonthsSince?: string | null;
}): LateArrivalSyncPlan {
  const entryByFile = new Map(input.entries.map((entry) => [entry.driveFileId, entry]));
  const lateFiles = new Set<string>();
  const detected: DetectedLateArrival[] = [];

  for (const file of input.files) {
    const known = entryByFile.get(file.driveFileId);
    // Hugo's own move put it here: arriving in its target is not arriving late.
    if (known?.status === "moved" && known.targetMonthKey && known.targetMonthKey === (file.period ?? file.monthKey)) {
      continue;
    }
    const afterClose = isLateArrival(file, input.closedAtByMonth.get(file.monthKey));
    const afterBooking = !afterClose && isPassedMonthArrival(file, input.passedMonthsSince);
    if (!afterClose && !afterBooking) {
      continue;
    }
    lateFiles.add(file.driveFileId);
    const arrivedAt = afterClose ? arrivalTimeOf(file) : uploadTimeOf(file)!;
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

/** A folder of the target month a late arrival may be moved into. */
export type DestinationFolder = { name: string; driveFolderId: string };

export type LateArrivalAssessment =
  /** Proposed: into the month being booked, the folder of the same name. */
  | { kind: "move"; targetMonthKey: string; targetFolderId: string }
  /** A folder whose documents belong to their period: a bank statement, payroll, issued invoices. */
  | { kind: "warning"; reason: "not-movable-folder" }
  /** No month to move it into: the booked month is closed or missing, and no later one is open. */
  | { kind: "warning"; reason: "no-open-month" }
  /** The target month has no folder of that name; Hugo does not create it (ADR 0006, amended 2026-11-11). */
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
  targetMonthKey: string | null;
  /** The month the file came into; a target not after it is no target. */
  sourceMonthKey?: string;
  destinationFolders: readonly DestinationFolder[];
}): LateArrivalAssessment {
  if (!input.movableFolderNames.includes(input.folderSlot)) {
    return { kind: "warning", reason: "not-movable-folder" };
  }
  // Never back into the month it came from, or an older one.
  if (!input.targetMonthKey || (input.sourceMonthKey !== undefined && input.targetMonthKey <= input.sourceMonthKey)) {
    return { kind: "warning", reason: "no-open-month" };
  }
  const destination = input.destinationFolders.find((folder) => folder.name === input.folderSlot);
  if (!destination) {
    return { kind: "warning", reason: "missing-destination", targetMonthKey: input.targetMonthKey };
  }
  if (!input.canMove) {
    return { kind: "warning", reason: "cannot-move" };
  }
  return { kind: "move", targetMonthKey: input.targetMonthKey, targetFolderId: destination.driveFolderId };
}

/** The warning in Slovak, as the screen shows it. */
export function lateArrivalWarningText(assessment: Exclude<LateArrivalAssessment, { kind: "move" }>, folderSlot: string): string {
  switch (assessment.reason) {
    case "not-movable-folder":
      return `Priečinok „${folderSlot}“ patrí k svojmu obdobiu — doklad sa nepresúva. Skontroluj ho v uzavretom mesiaci.`;
    case "no-open-month":
      return "Nie je mesiac, do ktorého by sa doklad presunul: spracúvaný mesiac je uzavretý alebo chýba.";
    case "missing-destination":
      return `Mesiac ${assessment.targetMonthKey} nemá priečinok „${folderSlot}“. Vytvor ho v Drive a doklad sa ponúkne na presun.`;
    case "cannot-move":
      return "Drive nedovoľuje doklad presunúť (súbor patrí klientovi alebo má obmedzené práva).";
  }
}
