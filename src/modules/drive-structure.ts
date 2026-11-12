import {
  classifyFolder,
  expectedSlotsFor,
  slotsFilledBy,
  parseMonthFolder,
  type FolderClassification,
} from "./folder-taxonomy";
import { countWithNoun } from "./format-sk";

/**
 * *Štruktúra Drive* (ADR 0007, amended 2026-11-11; PRD 0004). One company's
 * folders are checked against the layout the office pre-creates. A deviation
 * is a fact about Drive, recomputed on every sweep: nothing here is a to-do,
 * and a fix in Drive clears it on the next sweep.
 *
 * This module is pure: the caller hands in the folders it has already read.
 */

/**
 * Every kind the check can produce. Company-level kinds (prefix, year, months
 * outside the pattern, files misplaced) join this union with their own slice.
 */
export type StructureDeviationKind =
  | "subfolder-missing"
  | "subfolder-repair"
  | "folder-unrecognised";

/**
 * `blocking`: documents have nowhere to go until someone acts (a missing slot).
 * `attention`: a folder needs a decision, or a one-click fix is on offer.
 */
export type StructureSeverity = "blocking" | "attention";

const SEVERITY: Record<StructureDeviationKind, StructureSeverity> = {
  "subfolder-missing": "blocking",
  "subfolder-repair": "attention",
  "folder-unrecognised": "attention",
};

export type StructureFolderInput = {
  driveFolderId: string;
  name: string;
};

export type StructureMonthInput = StructureFolderInput & {
  /** Direct child folders of the month folder. */
  children: StructureFolderInput[];
};

export type StructureCheckInput = {
  company: StructureFolderInput;
  /** Every month folder the sweep found; only the current year is checked. */
  months: StructureMonthInput[];
  canonicalFolderNames: readonly string[];
  /** `YYYY_MM` of the current calendar month on the office clock. */
  currentMonthKey: string;
};

export type StructureDeviation = {
  kind: StructureDeviationKind;
  severity: StructureSeverity;
  /** Human Drive path. A missing folder is shown where it should be. */
  path: string;
  monthKey: string | null;
  /** The Drive folder concerned; null when the folder does not exist. */
  folderId: string | null;
  /** The name in Drive, for a folder that exists. */
  observedName: string | null;
  /** The canonical name that should exist, for a missing folder. */
  expectedName: string | null;
  /** The rename the existing repair flow would propose, for a near-miss. */
  repair: { targetName: string } | null;
};

function nfc(value: string): string {
  return value.normalize("NFC");
}

function joinPath(...segments: string[]): string {
  return segments.map(nfc).join("/");
}

export function checkCompanyStructure(input: StructureCheckInput): StructureDeviation[] {
  const settings = {
    canonicalFolderNames: input.canonicalFolderNames.map(nfc),
  };
  const currentYear = Number(input.currentMonthKey.slice(0, 4));
  const companyName = nfc(input.company.name);

  const currentYearMonths = input.months
    .flatMap((month) => {
      const parsed = parseMonthFolder(month.name);
      return parsed && parsed.year === currentYear ? [{ month, parsed }] : [];
    })
    .sort((left, right) => left.parsed.key.localeCompare(right.parsed.key));

  const deviations: StructureDeviation[] = [];

  for (const { month, parsed } of currentYearMonths) {
    const classified = month.children.map((child) => ({
      child,
      classification: classifyFolder(child.name, settings, parsed.key),
    }));

    // A slot is filled by its canonical folder or by the near-miss that will
    // become it. The near-miss is reported once, as a repair, not twice.
    const filled = new Set<string>();
    for (const { classification } of classified) {
      // An older name fills its slot too (2026-11-12): the old `04 Bločky` fills both receipt slots.
      for (const slot of slotsFilledBy(classification)) {
        filled.add(slot);
      }
    }

    for (const canonicalName of expectedSlotsFor(parsed.key, settings.canonicalFolderNames)) {
      if (filled.has(canonicalName)) {
        continue;
      }
      deviations.push(
        build(companyName, parsed.key, {
          kind: "subfolder-missing",
          folderId: null,
          observedName: null,
          expectedName: canonicalName,
          repair: null,
          pathSegment: canonicalName,
        }),
      );
    }

    for (const { child, classification } of classified) {
      deviations.push(...deviationForChild(companyName, parsed.key, child, classification));
    }
  }

  return deviations;
}

function deviationForChild(
  companyName: string,
  monthKey: string,
  child: StructureFolderInput,
  classification: FolderClassification,
): StructureDeviation[] {
  if (classification.kind === "canonical") {
    return [];
  }

  const observedName = nfc(child.name);
  if (classification.kind === "repair-candidate") {
    return [
      build(companyName, monthKey, {
        kind: "subfolder-repair",
        folderId: child.driveFolderId,
        observedName,
        expectedName: null,
        repair: { targetName: nfc(classification.targetName) },
        pathSegment: observedName,
      }),
    ];
  }

  return [
    build(companyName, monthKey, {
      kind: "folder-unrecognised",
      folderId: child.driveFolderId,
      observedName,
      expectedName: null,
      repair: null,
      pathSegment: observedName,
    }),
  ];
}

function build(
  companyName: string,
  monthKey: string,
  detail: {
    kind: StructureDeviationKind;
    folderId: string | null;
    observedName: string | null;
    expectedName: string | null;
    repair: { targetName: string } | null;
    pathSegment: string;
  },
): StructureDeviation {
  return {
    kind: detail.kind,
    severity: SEVERITY[detail.kind],
    path: joinPath(companyName, monthKey, detail.pathSegment),
    monthKey,
    folderId: detail.folderId,
    observedName: detail.observedName,
    expectedName: detail.expectedName,
    repair: detail.repair,
  };
}

export const DEVIATION_FORMS = ["odchýlka", "odchýlky", "odchýlok"] as const;

/** "Štruktúra: 3 odchýlky" for the badge on a company row. */
export function structureBadgeLabel(count: number): string {
  return `Štruktúra: ${countWithNoun(count, DEVIATION_FORMS)}`;
}
