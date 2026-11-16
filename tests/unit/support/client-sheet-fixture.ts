import { CLIENT_SHEET_COLUMNS, type ColumnKey } from "../../../src/modules/client-sheet.ts";

/**
 * A made-up client sheet: invented companies, IČOs with valid check digits, invented
 * addresses. Never the office's real sheet, which holds client data.
 */

export const FIXTURE_HEADERS: ColumnKey[] = Object.keys(CLIENT_SHEET_COLUMNS) as ColumnKey[];

/** CSV quoting as a spreadsheet writes it: a cell with a comma, quote or line break is wrapped. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvText(
  headers: readonly ColumnKey[],
  rows: ReadonlyArray<Partial<Record<ColumnKey, string>>>,
): string {
  const head = headers.map((key) => csvCell(CLIENT_SHEET_COLUMNS[key])).join(",");
  const body = rows.map((row) => headers.map((key) => csvCell(row[key] ?? "")).join(","));
  return [head, ...body].join("\n") + "\n";
}

/** Companies as the database holds them: Drive names carry the "Doklady " prefix. */
export const FIXTURE_COMPANIES = [
  { id: 1, driveFolderId: "folder-alfa", name: "Doklady Alfa s.r.o.", groupName: "Eva", archived: false, active: true },
  { id: 2, driveFolderId: "folder-beta", name: "Doklady Beta Štúdio s.r.o.", groupName: "Katarína", archived: false, active: true },
  { id: 3, driveFolderId: "folder-gamma", name: "Doklady Gama, a.s.", groupName: "Archív", archived: true, active: true },
  { id: 4, driveFolderId: "folder-epsilon", name: "Doklady Epsilon s.r.o.", groupName: null, archived: false, active: true },
  { id: 5, driveFolderId: "folder-zeta", name: "Doklady Zeta s.r.o.", groupName: "Eva", archived: false, active: true },
];

/**
 * Alfa's profile was saved by hand: its address differs from the sheet's.
 * Gama has only an IČO. Zeta matches the sheet exactly.
 */
export const FIXTURE_PROFILES = [
  {
    companyId: 1,
    country: "SK",
    legalName: "Alfa s.r.o.",
    address: "Pod Hradom 1, Bratislava",
    ico: "12345679",
    dic: "2020000001",
    icDph: "",
    registerSource: "manual",
    savedAt: "2026-10-01T08:00:00.000Z",
  },
  {
    companyId: 3,
    country: "SK",
    legalName: "",
    address: "",
    ico: "50000004",
    dic: "",
    icDph: "",
    registerSource: "rpo+ruz",
    savedAt: "2026-10-02T08:00:00.000Z",
  },
  {
    companyId: 5,
    country: "SK",
    legalName: "Zeta s.r.o.",
    address: "Ulica 3, Žilina",
    ico: "30000009",
    dic: "2020000005",
    icDph: "SK2020000005",
    registerSource: "manual",
    savedAt: "2026-10-03T08:00:00.000Z",
  },
];

/**
 * Rows, in this order:
 * 1 Alfa, by folder: changed (address hand-saved, IČ DPH empty).
 * 2 Beta, by name only: new, a guess, with a Vedie that disagrees with Drive.
 * 3 Gama, by folder: only fills, archived with Spolupráca ukončená (no disagreement).
 * 4 Epsilon: a 7-digit IČO, malformed, and zaniknutý while aktívna.
 * 5 Zeta, by IČO: unchanged.
 * 6 Neznáma: matches nothing.
 */
export const FIXTURE_ROWS: Array<Partial<Record<ColumnKey, string>>> = [
  {
    client: "Alfa",
    officialName: "Alfa s.r.o.",
    legalForm: "s.r.o.",
    ico: "12345679",
    dic: "2020000001",
    icDph: "SK2020000001",
    vatRegistration: "§4",
    vatPeriod: "mesačne",
    seat: "Pod Hradom 2, Bratislava",
    status: "aktívny",
    keeper: "Eva",
    cooperation: "aktívna",
    folderId: "folder-alfa",
    updatedAt: "2026-11-01",
  },
  {
    client: "Beta Štúdio s.r.o.",
    officialName: "Beta Štúdio s.r.o.",
    legalForm: "s.r.o.",
    ico: "87654326",
    dic: "2020000002",
    vatRegistration: "§4",
    vatPeriod: "mesačne",
    seat: "Hlavná 5, Košice",
    status: "aktívny",
    keeper: "Eva",
    cooperation: "aktívna",
    updatedAt: "2026-11-01",
  },
  {
    client: "Gama",
    officialName: "Gama, a.s.",
    legalForm: "a.s.",
    ico: "50000004",
    dic: "2020000003",
    icDph: "SK2020000003",
    vatRegistration: "§4",
    vatFrom: "2026-01-01",
    vatPeriod: "štvrťročne",
    seat: "Mlynská 1, Trnava",
    status: "zaniknutý 01.05.2026",
    keeper: "Archív",
    cooperation: "ukončená",
    folderId: "folder-gamma",
    updatedAt: "2026-11-01",
  },
  {
    client: "Epsilon",
    officialName: "Epsilon s.r.o.",
    legalForm: "s.r.o.",
    ico: "1234567",
    status: "zaniknutý 01.05.2026",
    cooperation: "aktívna",
    folderId: "folder-epsilon",
    updatedAt: "2026-11-01",
  },
  {
    client: "Zeta",
    officialName: "Zeta s.r.o.",
    legalForm: "s.r.o.",
    ico: "30000009",
    dic: "2020000005",
    icDph: "SK2020000005",
    vatRegistration: "§4",
    vatPeriod: "mesačne",
    seat: "Ulica 3, Žilina",
    status: "aktívny",
    keeper: "Eva",
    cooperation: "aktívna",
    folderId: "folder-zeta",
    updatedAt: "2026-11-01",
  },
  {
    client: "Neznáma",
    folderId: "folder-nobody",
    updatedAt: "2026-11-01",
  },
];

export const FIXTURE_CSV = csvText(FIXTURE_HEADERS, FIXTURE_ROWS);
