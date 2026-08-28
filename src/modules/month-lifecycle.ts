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

function slotIsOccupied(
  canonicalName: string,
  existingFolders: ExistingMonthFolder[],
): boolean {
  const canonicalPrefix = folderSlotPrefix(canonicalName);

  for (const folder of existingFolders) {
    const { classification } = folder;

    if (
      classification.kind === "canonical" &&
      classification.name === canonicalName
    ) {
      return true;
    }

    if (
      classification.kind === "repair-candidate" &&
      classification.targetName === canonicalName
    ) {
      return true;
    }

    if (
      classification.kind === "unknown" ||
      classification.kind === "repair-candidate"
    ) {
      const existingPrefix = folderSlotPrefix(folder.name);
      if (canonicalPrefix && existingPrefix === canonicalPrefix) {
        return true;
      }
    }
  }

  return false;
}

export function planMonthScaffolding(
  existingFolders: ExistingMonthFolder[],
  canonicalFolderNames: readonly string[],
): string[] {
  return canonicalFolderNames.filter(
    (canonicalName) => !slotIsOccupied(canonicalName, existingFolders),
  );
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
