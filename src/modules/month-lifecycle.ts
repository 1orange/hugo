import { slotsFilledBy, type FolderClassification } from "./folder-taxonomy";

export type CompanyStage = "idle" | "collect" | "extract" | "tick" | "export" | "close";

export type ExistingMonthFolder = {
  name: string;
  classification: FolderClassification;
};

export type CompanyStageView = {
  stage: CompanyStage;
  awaitingCount: number | null;
};

/** The office's calendar: month boundaries are read here, not in UTC. */
export const OFFICE_TIME_ZONE = "Europe/Bratislava";

/**
 * The `YYYY_MM` key of the calendar month an instant falls in on the office
 * clock. Takes the instant as input, so callers decide what "now" is.
 */
export function monthKeyAt(instant: Date, timeZone: string = OFFICE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  return `${year}_${month}`;
}

/**
 * The booking month: the calendar month before the current one on the office
 * clock. The office books last month (in November, October), so the home
 * screen and the reading window's recent tier start from it. In January it is
 * December of the previous year. Callers pass the instant, as with monthKeyAt.
 */
export function bookingMonthKey(instant: Date, timeZone: string = OFFICE_TIME_ZONE): string {
  const [yearText, monthText] = monthKeyAt(instant, timeZone).split("_");
  const year = Number(yearText);
  const month = Number(monthText);
  return month === 1
    ? `${year - 1}_12`
    : `${year}_${String(month - 1).padStart(2, "0")}`;
}

/** Whether a string is a month key: `YYYY_MM` with the month 01 to 12. */
export function isMonthKey(value: string): boolean {
  return /^\d{4}_(0[1-9]|1[0-2])$/.test(value);
}

/**
 * A future month is one whose key is after the current calendar month. Keys
 * are zero-padded `YYYY_MM`, so they compare correctly as strings.
 */
export function isFutureMonth(monthKey: string, currentMonthKey: string): boolean {
  return monthKey > currentMonthKey;
}

/**
 * The open month: the newest month without `closedAt` whose key is not after
 * the current month. The office pre-creates every month of the year, so
 * "newest unclosed" alone would make December open in November (ADR 0005,
 * amended 2026-11-11).
 */
export function selectOpenMonthKey(
  months: ReadonlyArray<{ monthKey: string; closedAt: string | null }>,
  currentMonthKey: string,
): string | null {
  let open: string | null = null;
  for (const month of months) {
    if (month.closedAt !== null || isFutureMonth(month.monthKey, currentMonthKey)) {
      continue;
    }
    if (open === null || month.monthKey > open) {
      open = month.monthKey;
    }
  }
  return open;
}

/**
 * Where a late arrival is proposed to go (ADR 0006, amended 2026-11-24): the
 * month being booked, the previous one on the office clock; if that one is
 * closed or missing, the next unclosed month up to the current one; with none
 * of those, the open month.
 */
export function selectLateArrivalTargetMonthKey(
  months: ReadonlyArray<{ monthKey: string; closedAt: string | null }>,
  instant: Date,
  timeZone: string = OFFICE_TIME_ZONE,
): string | null {
  const booking = bookingMonthKey(instant, timeZone);
  const current = monthKeyAt(instant, timeZone);
  const candidates = months
    .filter((month) => month.closedAt === null && month.monthKey >= booking && month.monthKey <= current)
    .map((month) => month.monthKey)
    .sort();
  // A client with no month from the booked one on (a dormant client, an old
  // layout) keeps the open month, as before.
  return candidates[0] ?? selectOpenMonthKey(months, current);
}

/**
 * Whether a file uploaded at `uploadedAt` into `monthKey` came after that month
 * stopped being booked: from November on, anything put into September or earlier.
 */
export function uploadedAfterMonthWasBooked(
  monthKey: string,
  uploadedAt: string,
  timeZone: string = OFFICE_TIME_ZONE,
): boolean {
  const instant = new Date(uploadedAt);
  return !Number.isNaN(instant.getTime()) && bookingMonthKey(instant, timeZone) > monthKey;
}

function folderSlotPrefix(name: string): string | null {
  const match = /^(\d{2})\s/.exec(name);
  return match ? match[1]! : null;
}

export type SlotOccupancy =
  /** The folder exists, or a repair candidate will become it. */
  | { state: "present" }
  /** Nothing occupies the slot. Hugo never creates it; the office does. */
  | { state: "absent" }
  /**
   * A folder sharing the slot's number exists but is not that folder. Creating
   * the canonical name anyway would leave two folders competing for one slot,
   * so the slot is reported with the folder that blocks it and she decides.
   */
  | { state: "blocked"; byFolderName: string };

function slotOccupancy(
  canonicalName: string,
  existingFolders: ExistingMonthFolder[],
): SlotOccupancy {
  const canonicalPrefix = folderSlotPrefix(canonicalName);

  for (const folder of existingFolders) {
    const { classification } = folder;

    // Its own folder, an older name for it, or the near-miss that will become it.
    if (slotsFilledBy(classification).includes(canonicalName)) {
      return { state: "present" };
    }
  }

  for (const folder of existingFolders) {
    if (
      folder.classification.kind === "unknown" ||
      folder.classification.kind === "repair-candidate"
    ) {
      const existingPrefix = folderSlotPrefix(folder.name);
      if (canonicalPrefix && existingPrefix === canonicalPrefix) {
        return { state: "blocked", byFolderName: folder.name };
      }
    }
  }

  return { state: "absent" };
}

export type MissingSlot = {
  canonicalName: string;
  blockedByFolderName: string | null;
};

/**
 * Canonical slots that have no folder. The office owns the Drive structure
 * (ADR 0005 and 0006, amended 2026-11-11), so a missing slot stays missing until
 * someone creates it. The month view lists only folders that exist, so without
 * this the gap would be invisible and documents would have nowhere to go.
 */
export function describeMissingSlots(
  existingFolders: ExistingMonthFolder[],
  canonicalFolderNames: readonly string[],
): MissingSlot[] {
  const missing: MissingSlot[] = [];

  for (const canonicalName of canonicalFolderNames) {
    const occupancy = slotOccupancy(canonicalName, existingFolders);
    if (occupancy.state === "present") {
      continue;
    }

    missing.push({
      canonicalName,
      blockedByFolderName:
        occupancy.state === "blocked" ? occupancy.byFolderName : null,
    });
  }

  return missing;
}

export function deriveCompanyStage(input: {
  openMonthKey: string | null;
  awaitingCount: number | null;
  hasDocuments?: boolean;
}): CompanyStageView {
  if (!input.openMonthKey) {
    return { stage: "idle", awaitingCount: input.awaitingCount };
  }

  if (!input.hasDocuments) {
    return { stage: "collect", awaitingCount: null };
  }

  if (input.awaitingCount !== null && input.awaitingCount > 0) {
    return { stage: "tick", awaitingCount: input.awaitingCount };
  }

  return { stage: "close", awaitingCount: input.awaitingCount };
}
