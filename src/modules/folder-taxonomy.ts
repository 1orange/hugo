/**
 * The document types of a month, as the office defined them from 2027_01 ("Štruktúra
 * disku Doklady klientov", 2026-11-11). The code is the type: from 2027_01 a folder
 * is read by its two-digit code, whatever follows it; older months by their names.
 */
export const CANONICAL_FOLDER_NAMES = [
  "01 Vystavené faktúry",
  "02 Prijaté faktúry",
  "03 Bankové výpisy",
  "04 Bločky",
  "05 Cestovné príkazy",
  "06 Ostatné dokumenty",
  "07 Mzdy",
  "08 DPH",
] as const;

/** The first month whose document folders are read by code. */
export const CODE_SCHEME_FROM_MONTH = "2027_01";

/** Whether a month's folders follow the code scheme (2027_01 on). */
export function usesCodeScheme(monthKey: string | null | undefined): boolean {
  return monthKey !== null && monthKey !== undefined && monthKey >= CODE_SCHEME_FROM_MONTH;
}

/**
 * The types an older month (before 2027_01) was not expected to hold: it had no travel
 * orders or VAT folder of its own. Older months are not changed by the office's
 * scripts, so they are not expected to grow them.
 */
export const NOT_EXPECTED_IN_OLDER_MONTHS = ["05 Cestovné príkazy", "08 DPH"] as const;

/** The slots a month is expected to have, given the canonical list in settings. */
export function expectedSlotsFor(monthKey: string, canonicalFolderNames: readonly string[]): string[] {
  if (usesCodeScheme(monthKey)) {
    return [...canonicalFolderNames];
  }
  return canonicalFolderNames.filter(
    (name) => !(NOT_EXPECTED_IN_OLDER_MONTHS as readonly string[]).includes(name.normalize("NFC")),
  );
}

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
  | {
      kind: "canonical";
      /** The slot: one of the canonical names. */
      name: string;
      /** The name in Drive, when it is an accepted older name rather than the slot's own. */
      observedName?: string;
    }
  | {
      kind: "repair-candidate";
      observedName: string;
      targetName: string;
    }
  | { kind: "unknown"; name: string };

/** `2026_10`, and from 2027 `2027_01 január`: the key is the start of the name. */
const MONTH_PATTERN = /^(\d{4})_(\d{2})(?=\s|$)/u;

/**
 * The names older months (before 2027_01) use, and the type each stands for. Their
 * numbers mean something else than from 2027 (an old `05` is a card receipt or other
 * documents, a new one a travel order), so they are mapped by name, never by number
 * (the office's table, 2026-11-11; the rarer variants from the live drive). `slot`
 * is the type; cash and card receipts are one type, `04 Bločky`.
 */
export const ACCEPTED_FOLDER_NAMES: Readonly<Record<string, { slot: string }>> = {
  "04 Platby hotovosťou": { slot: "04 Bločky" },
  "05 Platby kartou": { slot: "04 Bločky" },
  "05 Platby firemnou kartou": { slot: "04 Bločky" },
  "04 Bločky_hotovosť": { slot: "04 Bločky" },
  "04 Bločky hotovosť": { slot: "04 Bločky" },
  "05 Bločky_firemná karta": { slot: "04 Bločky" },
  "05 Bločky firemná karta": { slot: "04 Bločky" },
  "06 Iné doklady": { slot: "06 Ostatné dokumenty" },
  "05 Iné doklady": { slot: "06 Ostatné dokumenty" },
  "06 Cestovné príkazy": { slot: "05 Cestovné príkazy" },
  "06 Mzdy": { slot: "07 Mzdy" },
  "07 DPH": { slot: "08 DPH" },
};

function acceptedClassification(
  name: string,
  canonicalFolderNames: readonly string[],
): FolderClassification | null {
  const entry = Object.entries(ACCEPTED_FOLDER_NAMES).find(
    ([accepted]) => accepted.normalize("NFC") === name,
  )?.[1];
  if (!entry) {
    return null;
  }
  // Only for a slot the office still uses: one removed from the settings takes its old names with it.
  const slot = canonicalFolderNames.find((canonical) => canonical.normalize("NFC") === entry.slot);
  if (!slot) {
    return null;
  }
  return { kind: "canonical", name: slot, observedName: name };
}

const TYPE_CODE = /^(0[1-8])(?=\s|$)/u;

/**
 * From 2027_01 a folder is its code: `04 Bločky`, `04 bločky a pokladňa` and `04` are
 * all the receipts. No near-misses there: a folder without a code is unknown.
 */
function classifyByCode(name: string, canonicalFolderNames: readonly string[]): FolderClassification {
  const code = TYPE_CODE.exec(name)?.[1];
  const slot = code ? canonicalFolderNames.find((canonical) => canonical.startsWith(`${code} `)) : undefined;
  if (!slot) {
    return { kind: "unknown", name };
  }
  return slot.normalize("NFC") === name ? { kind: "canonical", name: slot } : { kind: "canonical", name: slot, observedName: name };
}

/** The slot a folder fills, as a list (empty for an unknown folder). */
export function slotsFilledBy(classification: FolderClassification): string[] {
  if (classification.kind === "canonical") {
    return [classification.name];
  }
  return classification.kind === "repair-candidate" ? [classification.targetName] : [];
}

/** The name a folder carries in Drive, whatever slot it is. */
export function observedFolderName(classification: FolderClassification): string {
  if (classification.kind === "repair-candidate") {
    return classification.observedName;
  }
  return classification.kind === "canonical" ? (classification.observedName ?? classification.name) : classification.name;
}

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
  const match = MONTH_PATTERN.exec(name.normalize("NFC").trim());
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

/**
 * What a month's subfolder is. `monthKey` is the month it is in: from 2027_01 the
 * folder is read by its code; before, and when the month is not known, by its name
 * (canonical, an older accepted name, or a near-miss of one of them).
 */
export function classifyFolder(
  name: string,
  settings: FolderTaxonomySettings,
  monthKey?: string | null,
): FolderClassification {
  if (usesCodeScheme(monthKey)) {
    return classifyByCode(name.normalize("NFC").trim(), settings.canonicalFolderNames);
  }
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
  const accepted = acceptedClassification(normalized, settings.canonicalFolderNames);
  if (accepted) {
    return accepted;
  }

  // A near-miss of an older name is repaired to the slot's current name.
  const folded = fold(name);
  const candidates = [
    ...settings.canonicalFolderNames.map((canonical) => ({ spelled: canonical, canonical })),
    ...Object.entries(ACCEPTED_FOLDER_NAMES).flatMap(([spelled, entry]) =>
      entry.slot !== null && settings.canonicalFolderNames.includes(entry.slot)
        ? [{ spelled, canonical: entry.slot }]
        : [],
    ),
  ];
  const nearest = new Map<string, number>();
  for (const candidate of candidates) {
    const distance = editDistance(folded, fold(candidate.spelled));
    nearest.set(candidate.canonical, Math.min(distance, nearest.get(candidate.canonical) ?? Infinity));
  }
  const ranked = [...nearest.entries()]
    .map(([canonical, distance]) => ({ canonical, distance }))
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
