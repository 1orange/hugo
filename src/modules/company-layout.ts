import { classifyFolder, parseMonthFolder, type FolderTaxonomySettings } from "./folder-taxonomy";

/**
 * The layout of one client's Drive folder (PRD 0007, issue 06). Hugo reads
 * documents only from `Client / YYYY_MM / type` (ADR 0007). A client laid out
 * any other way is read by nobody, so the sweep says what it found and what it
 * expects, and the office fixes it in Drive. Hugo never creates or moves folders
 * there (ADR 0006).
 *
 * Pure: the caller hands in folder names. Names are compared NFC, because Drive
 * delivers most of them in NFD.
 */

export type CompanyLayoutKind =
  /** `YYYY_MM` folders for the year sit directly in the client folder. */
  | "months"
  /** The months sit inside a year folder: `Client / 2026 / 2026_10`. */
  | "year-months"
  /** Type folders sit inside a year folder, with no months: `Client / 2026 / 02 Prijaté faktúry`. */
  | "year-types"
  /** Type folders sit directly in the client folder: `Client / 02 Prijaté faktúry`. */
  | "types"
  /** The client folder holds no folders at all (not set up yet). */
  | "empty"
  /** Anything else: folders Hugo does not recognise as a layout. */
  | "other";

/** A folder directly in the client folder, with the names of the folders directly inside it. */
export type LayoutFolder = { name: string; childNames: string[] };

export type CompanyLayout = {
  kind: CompanyLayoutKind;
  /** The year the layout was read for: the booking month's year (issue 06). */
  year: number;
  /** Up to three folder paths relative to the client folder, which show the layout: `2026/2026_10`. */
  examples: string[];
};

/** Enough examples to show what was found, few enough to read at a glance. */
const EXAMPLE_LIMIT = 3;

function nfc(value: string): string {
  return value.normalize("NFC").trim();
}

/**
 * The layout a client folder is in, read for `year`. Checked in this order, so
 * the first match wins: months directly in the client folder are the expected
 * layout whatever else is there (older year folders beside them, as in
 * `2023`–`2025`); a year folder with months in it comes before one with type
 * folders in it; type folders directly in the client come after both. A client
 * folder with no folders at all is `empty`; anything left is `other`.
 */
export function detectCompanyLayout(input: {
  folders: LayoutFolder[];
  year: number;
  settings: FolderTaxonomySettings;
}): CompanyLayout {
  const { year, settings } = input;
  const folders = input.folders.map((folder) => ({
    name: nfc(folder.name),
    childNames: folder.childNames.map(nfc),
  }));
  const isMonthOfYear = (name: string) => parseMonthFolder(name)?.year === year;
  const isTypeFolder = (name: string) => classifyFolder(name, settings).kind !== "unknown";
  const yearFolders = folders.filter((folder) => folder.name === String(year));

  const monthsDirectly = folders.filter((folder) => isMonthOfYear(folder.name));
  if (monthsDirectly.length > 0) {
    return layoutOf("months", year, monthsDirectly.map((folder) => folder.name));
  }

  const monthsInYear = yearFolders.flatMap((yearFolder) =>
    yearFolder.childNames.filter(isMonthOfYear).map((name) => `${yearFolder.name}/${name}`),
  );
  if (monthsInYear.length > 0) {
    return layoutOf("year-months", year, monthsInYear);
  }

  const typesInYear = yearFolders.flatMap((yearFolder) =>
    yearFolder.childNames.filter(isTypeFolder).map((name) => `${yearFolder.name}/${name}`),
  );
  if (typesInYear.length > 0) {
    return layoutOf("year-types", year, typesInYear);
  }

  const typesDirectly = folders.filter((folder) => isTypeFolder(folder.name));
  if (typesDirectly.length > 0) {
    return layoutOf("types", year, typesDirectly.map((folder) => folder.name));
  }

  if (folders.length === 0) {
    return layoutOf("empty", year, []);
  }
  return layoutOf("other", year, folders.map((folder) => folder.name));
}

function layoutOf(kind: CompanyLayoutKind, year: number, examples: string[]): CompanyLayout {
  return { kind, year, examples: examples.slice(0, EXAMPLE_LIMIT) };
}

/** What Hugo found, in Slovak, for the structure screen. */
export function describeFoundLayout(layout: CompanyLayout): string {
  const examples = layout.examples.map((example) => `„${example}“`).join(", ");
  switch (layout.kind) {
    case "months":
      return `Mesiace ${layout.year} sú priamo v priečinku klienta.`;
    case "year-months":
      return `Mesiace sú vnorené v priečinku roka ${layout.year} (napríklad ${examples}).`;
    case "year-types":
      return `Typy dokladov sú v priečinku roka ${layout.year} a mesačné priečinky chýbajú (napríklad ${examples}).`;
    case "types":
      return `Typy dokladov sú priamo v priečinku klienta, bez roka a mesiacov (napríklad ${examples}).`;
    case "empty":
      return "Priečinok klienta je prázdny. Štruktúra ešte nie je nastavená.";
    case "other":
      return `Priečinky klienta nezodpovedajú žiadnej štruktúre (napríklad ${examples}).`;
  }
}

/** What Hugo expects, in Slovak: the month folders for the year, with the type folders inside each. */
export function describeExpectedLayout(year: number): string {
  return `${year}_01 … ${year}_12 priamo v priečinku klienta a v každom mesiaci priečinky typov dokladov.`;
}
