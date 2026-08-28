export const CANONICAL_FOLDER_NAMES = [
  "01 Vystavené faktúry",
  "02 Prijaté faktúry",
  "03 Bankové výpisy",
  "04 Bločky_hotovosť",
  "05 Bločky_firemná karta",
  "06 Iné doklady",
  "07 Mzdy",
] as const;

export type FolderTaxonomySettings = {
  canonicalFolderNames: readonly string[];
  movableFolderNames?: readonly string[];
};

export type MonthFolder = {
  year: number;
  month: number;
  key: string;
};

export type FolderClassification =
  | { kind: "canonical"; name: string }
  | {
      kind: "repair-candidate";
      observedName: string;
      targetName: string;
    }
  | { kind: "unknown"; name: string };

const MONTH_PATTERN = /^(\d{4})_(\d{2})$/;

/**
 * A repair candidate becomes a confirmed rename in Drive, so proposing one for
 * a folder the client created on purpose would destroy their intent. Only names
 * that are near-misses of a canonical name qualify; everything else is unknown
 * and left alone.
 */
const MAX_REPAIR_DISTANCE = 2;

/**
 * Folds away the differences that are never meaningful in a folder name: case,
 * diacritics (clients type from keyboards that lack them), and the choice of
 * space or underscore as separator.
 */
function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length];
}

export function defaultFolderTaxonomySettings(): FolderTaxonomySettings {
  return { canonicalFolderNames: CANONICAL_FOLDER_NAMES };
}

export function parseMonthFolder(name: string): MonthFolder | null {
  const match = MONTH_PATTERN.exec(name);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }

  return { year, month, key: `${match[1]}_${match[2]}` };
}

export function classifyFolder(
  name: string,
  settings: FolderTaxonomySettings,
): FolderClassification {
  // Both sides are normalised because either can arrive in NFD: Drive names
  // from the uploader's filesystem, canonical names from her settings. Without
  // this, a folder identical on screen to its canonical name is classified as
  // needing a rename that would change nothing visible.
  const normalized = name.normalize("NFC");
  const canonical = settings.canonicalFolderNames.find(
    (candidate) => candidate.normalize("NFC") === normalized,
  );
  if (canonical) {
    return { kind: "canonical", name: canonical };
  }

  const folded = fold(name);
  const ranked = settings.canonicalFolderNames
    .map((canonical) => ({
      canonical,
      distance: editDistance(folded, fold(canonical)),
    }))
    .filter((candidate) => candidate.distance <= MAX_REPAIR_DISTANCE)
    .sort((a, b) => a.distance - b.distance);

  const [best, runnerUp] = ranked;

  // An ambiguous near-miss is not a typo we can resolve; guessing would rename
  // the folder into the wrong slot.
  if (!best || (runnerUp && runnerUp.distance === best.distance)) {
    return { kind: "unknown", name };
  }

  return {
    kind: "repair-candidate",
    observedName: name,
    targetName: best.canonical,
  };
}

export function isMovableFolder(
  name: string,
  settings: FolderTaxonomySettings & { movableFolderNames: readonly string[] },
): boolean {
  const classification = classifyFolder(name, settings);
  if (classification.kind !== "canonical") {
    return false;
  }

  return settings.movableFolderNames.includes(classification.name);
}
