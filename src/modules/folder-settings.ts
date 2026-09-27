import { classifyFolder } from "./folder-taxonomy";

export const DEFAULT_MOVABLE_FOLDER_NAMES = [
  "02 Prijaté faktúry",
  "04 Bločky_hotovosť",
  "05 Bločky_firemná karta",
  "06 Iné doklady",
] as const;

export type FolderListValidationError = {
  index: number;
  message: string;
};

export type FolderListValidationResult =
  | { ok: true; normalized: string[] }
  | { ok: false; errors: FolderListValidationError[] };

export type ExistingFolderRef = {
  companyId: number;
  companyName: string;
  monthKey: string;
  folderName: string;
};

export type AffectedFolder = ExistingFolderRef & {
  reason: "removal" | "rename-mismatch";
};

export type CanonicalListImpact = {
  totalAffected: number;
  removedCanonicalNames: string[];
  addedCanonicalNames: string[];
  affectedFolders: AffectedFolder[];
  /**
   * Folders that are unrecognised today and would become canonical. Adding a
   * name she already uses in Drive is the intended way to resolve an
   * unrecognised folder, so the preview has to confirm the change does what she
   * wants, not only warn about what it breaks.
   */
  newlyRecognisedFolders: ExistingFolderRef[];
  byCompany: Array<{
    companyId: number;
    companyName: string;
    count: number;
    folders: AffectedFolder[];
  }>;
};

function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();
}

export function normalizeFolderName(name: string): string {
  return name.trim().normalize("NFC");
}

export function validateFolderNameList(
  names: readonly string[],
  options?: { allowEmpty?: boolean },
): FolderListValidationResult {
  if (names.length === 0) {
    if (options?.allowEmpty) {
      return { ok: true, normalized: [] };
    }
    return {
      ok: false,
      errors: [{ index: 0, message: "Zoznam nemôže byť prázdny." }],
    };
  }

  const errors: FolderListValidationError[] = [];
  const seenExact = new Map<string, number>();
  const seenNfc = new Map<string, number>();
  const seenFolded = new Map<string, number>();
  const normalized: string[] = [];

  for (let index = 0; index < names.length; index += 1) {
    const raw = names[index] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) {
      errors.push({
        index,
        message: `Položka ${index + 1} je prázdna.`,
      });
      continue;
    }

    const nfc = trimmed.normalize("NFC");
    const folded = fold(nfc);

    if (seenExact.has(trimmed)) {
      errors.push({
        index,
        message: `Položka ${index + 1} je rovnaká ako položka ${seenExact.get(trimmed)! + 1}.`,
      });
    } else if (seenNfc.has(nfc)) {
      errors.push({
        index,
        message: `Položka ${index + 1} sa od položky ${seenNfc.get(nfc)! + 1} líši len normalizáciou Unicode.`,
      });
    } else if (seenFolded.has(folded)) {
      errors.push({
        index,
        message: `Položka ${index + 1} sa od položky ${seenFolded.get(folded)! + 1} líši len veľkosťou písmen.`,
      });
    }

    seenExact.set(trimmed, index);
    seenNfc.set(nfc, index);
    seenFolded.set(folded, index);
    normalized.push(nfc);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, normalized };
}

export function validateCanonicalFolderNames(
  names: readonly string[],
): FolderListValidationResult {
  return validateFolderNameList(names);
}

export function validateMovableFolderNames(
  names: readonly string[],
  canonicalFolderNames: readonly string[],
): FolderListValidationResult {
  const listResult = validateFolderNameList(names, { allowEmpty: true });
  if (!listResult.ok) {
    return listResult;
  }

  const canonicalNfc = new Set(
    canonicalFolderNames.map((name) => name.normalize("NFC")),
  );
  const errors: FolderListValidationError[] = [];

  for (let index = 0; index < listResult.normalized.length; index += 1) {
    const name = listResult.normalized[index]!;
    if (!canonicalNfc.has(name)) {
      errors.push({
        index,
        message: `Položka ${index + 1} („${name}“) nie je jedným z kanonických názvov priečinkov.`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return listResult;
}

export function previewCanonicalListImpact(input: {
  currentCanonicalNames: readonly string[];
  proposedCanonicalNames: readonly string[];
  existingFolders: readonly ExistingFolderRef[];
}): CanonicalListImpact {
  const currentSettings = {
    canonicalFolderNames: input.currentCanonicalNames,
  };
  const proposedSettings = {
    canonicalFolderNames: input.proposedCanonicalNames,
  };

  const currentNfc = new Set(
    input.currentCanonicalNames.map((name) => name.normalize("NFC")),
  );
  const proposedNfc = new Set(
    input.proposedCanonicalNames.map((name) => name.normalize("NFC")),
  );

  const removedCanonicalNames = input.currentCanonicalNames.filter(
    (name) => !proposedNfc.has(name.normalize("NFC")),
  );
  const addedCanonicalNames = input.proposedCanonicalNames.filter(
    (name) => !currentNfc.has(name.normalize("NFC")),
  );

  const affectedFolders: AffectedFolder[] = [];
  const newlyRecognisedFolders: ExistingFolderRef[] = [];

  for (const folder of input.existingFolders) {
    const current = classifyFolder(folder.folderName, currentSettings);
    const proposed = classifyFolder(folder.folderName, proposedSettings);

    if (current.kind !== "canonical") {
      if (proposed.kind === "canonical") {
        newlyRecognisedFolders.push(folder);
      }
      continue;
    }

    if (proposed.kind === "canonical") {
      continue;
    }

    const removed = removedCanonicalNames.some(
      (name) => name.normalize("NFC") === current.name.normalize("NFC"),
    );

    affectedFolders.push({
      ...folder,
      reason: removed ? "removal" : "rename-mismatch",
    });
  }

  const byCompanyMap = new Map<
    number,
    { companyId: number; companyName: string; folders: AffectedFolder[] }
  >();

  for (const folder of affectedFolders) {
    const existing = byCompanyMap.get(folder.companyId) ?? {
      companyId: folder.companyId,
      companyName: folder.companyName,
      folders: [],
    };
    existing.folders.push(folder);
    byCompanyMap.set(folder.companyId, existing);
  }

  const byCompany = [...byCompanyMap.values()]
    .map((entry) => ({
      companyId: entry.companyId,
      companyName: entry.companyName,
      count: entry.folders.length,
      folders: entry.folders,
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  return {
    totalAffected: affectedFolders.length,
    removedCanonicalNames,
    addedCanonicalNames,
    affectedFolders,
    newlyRecognisedFolders,
    byCompany,
  };
}
