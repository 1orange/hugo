import type { FolderClassification } from "./folder-taxonomy";

export type CompanyStage = "idle" | "collect" | "extract" | "pair" | "tick" | "export" | "close";

export type ExistingMonthFolder = {
  name: string;
  classification: FolderClassification;
};

export type CompanyStageView = {
  stage: CompanyStage;
  untickedCount: number | null;
};

const MONTH_KEY_PATTERN = /^(\d{4})_(\d{2})$/;

export function nextMonthKey(monthKey: string): string | null {
  const match = MONTH_KEY_PATTERN.exec(monthKey);
  if (!match) {
    return null;
  }

  let year = Number(match[1]);
  let month = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }

  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }

  return `${year}_${String(month).padStart(2, "0")}`;
}

function folderSlotPrefix(name: string): string | null {
  const match = /^(\d{2})\s/.exec(name);
  return match ? match[1]! : null;
}

export type SlotOccupancy =
  /** The folder exists, or a repair candidate will become it. */
  | { state: "present" }
  /** Nothing occupies the slot; scaffolding will create it. */
  | { state: "absent" }
  /**
   * A folder sharing the slot's number exists but is not that folder. Creating
   * the canonical name anyway would leave two folders competing for one slot,
   * so scaffolding stays out and she decides.
   */
  | { state: "blocked"; byFolderName: string };

function slotOccupancy(
  canonicalName: string,
  existingFolders: ExistingMonthFolder[],
): SlotOccupancy {
  const canonicalPrefix = folderSlotPrefix(canonicalName);

  for (const folder of existingFolders) {
    const { classification } = folder;

    if (
      classification.kind === "canonical" &&
      classification.name === canonicalName
    ) {
      return { state: "present" };
    }

    if (
      classification.kind === "repair-candidate" &&
      classification.targetName === canonicalName
    ) {
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

export function planMonthScaffolding(
  existingFolders: ExistingMonthFolder[],
  canonicalFolderNames: readonly string[],
): string[] {
  return canonicalFolderNames.filter(
    (canonicalName) =>
      slotOccupancy(canonicalName, existingFolders).state === "absent",
  );
}

export type MissingSlot = {
  canonicalName: string;
  blockedByFolderName: string | null;
};

/**
 * Canonical slots that have no folder. Without this the blocked case is
 * invisible: scaffolding declines to create the folder and the month view only
 * lists folders that exist, so documents would have nowhere to go and nothing
 * would say why.
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
  untickedCount: number | null;
  hasPayments?: boolean;
}): CompanyStageView {
  if (!input.openMonthKey) {
    return { stage: "idle", untickedCount: input.untickedCount };
  }

  // Later slices add payments, extraction and export signals. Until then the
  // earliest knowable stage is collect.
  if (!input.hasPayments) {
    return { stage: "collect", untickedCount: null };
  }

  if (input.untickedCount !== null && input.untickedCount > 0) {
    return { stage: "tick", untickedCount: input.untickedCount };
  }

  return { stage: "close", untickedCount: input.untickedCount };
}
