/**
 * The office's client sheet (*Klienti*), uploaded as CSV in Nastavenia (issue
 * 0005, slice 09). Pure: parsing, matching and the write plan. The service loads
 * the companies and profiles, the store writes what this module selects.
 *
 * The sheet holds real client data, so nothing here is logged or stored, and the
 * tests use made-up companies only.
 */
import { CLIENT_SHEET_REGISTER_SOURCE, normalizeSkIcDph, validateSkIcDph } from "./company-profile";
import { companyDisplayName } from "./company-display-name";
import { isValidIcoChecksum } from "./ico-checksum";

export { CLIENT_SHEET_REGISTER_SOURCE };

export const CLIENT_SHEET_COLUMNS = {
  client: "Klient",
  officialName: "Oficiálny názov",
  legalForm: "Právna forma",
  ico: "IČO",
  dic: "DIČ",
  icDph: "IČ DPH",
  vatRegistration: "Registrácia DPH",
  vatFrom: "Platiteľ DPH od",
  vatPeriod: "Obdobie DPH",
  seat: "Sídlo",
  status: "Stav subjektu",
  keeper: "Vedie",
  cooperation: "Spolupráca",
  folderId: "ID priečinka Doklady",
  updatedAt: "Aktualizované",
} as const;

export type ColumnKey = keyof typeof CLIENT_SHEET_COLUMNS;

/**
 * What this import reads. The legal form, VAT columns and the update date are
 * the VAT slice's and the sheet's own business, so a sheet without them still imports.
 */
const REQUIRED_COLUMNS: readonly ColumnKey[] = [
  "client",
  "officialName",
  "ico",
  "dic",
  "icDph",
  "seat",
  "status",
  "keeper",
  "cooperation",
  "folderId",
];

export type ClientSheetRow = {
  /** 1-based, counting data rows in sheet order; the preview names rows by it. */
  rowNumber: number;
  cells: Record<ColumnKey, string>;
};

export type ClientSheetParse =
  | { ok: true; rows: ClientSheetRow[] }
  | { ok: false; message: string };

/**
 * Headers are matched without case and diacritics, so "Oficialny nazov" and
 * "IČO" with a different Č encoding still find their column. Column order is free.
 */
function headerKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The sheet is exported from Google Sheets with commas, but a Slovak Excel saves
 * semicolons. The header line decides: whichever separator it uses more.
 */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

/**
 * RFC 4180 records: a quoted field may hold the delimiter, a line break or a doubled
 * quote. Returns null for an unclosed quote, which would otherwise swallow the rest of the sheet.
 * Blank records (a trailing newline, an empty line) are dropped.
 */
export function parseCsvRecords(text: string, delimiter: string): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
      }
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    return null;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ""));
}

export function parseClientSheet(text: string): ClientSheetParse {
  const records = parseCsvRecords(text.replace(/^﻿/, ""), detectDelimiter(text));
  if (records === null) {
    return { ok: false, message: "V tabuľke je neuzavretá úvodzovka." };
  }
  const [header, ...dataRecords] = records;
  if (!header) {
    return { ok: false, message: "Tabuľka je prázdna." };
  }

  const columnAt = new Map<string, number>();
  header.forEach((name, index) => {
    const key = headerKey(name);
    if (!columnAt.has(key)) {
      columnAt.set(key, index);
    }
  });

  const index = {} as Record<ColumnKey, number | undefined>;
  for (const key of Object.keys(CLIENT_SHEET_COLUMNS) as ColumnKey[]) {
    index[key] = columnAt.get(headerKey(CLIENT_SHEET_COLUMNS[key]));
  }

  const missing = REQUIRED_COLUMNS.filter((key) => index[key] === undefined).map(
    (key) => CLIENT_SHEET_COLUMNS[key],
  );
  if (missing.length === 1) {
    return { ok: false, message: `V tabuľke chýba stĺpec „${missing[0]}“.` };
  }
  if (missing.length > 1) {
    return { ok: false, message: `V tabuľke chýbajú stĺpce: ${missing.map((name) => `„${name}“`).join(", ")}.` };
  }

  const rows = dataRecords.map((record, position) => {
    const cells = {} as Record<ColumnKey, string>;
    for (const key of Object.keys(CLIENT_SHEET_COLUMNS) as ColumnKey[]) {
      const column = index[key];
      cells[key] = column === undefined ? "" : (record[column] ?? "");
    }
    return { rowNumber: position + 1, cells };
  });
  return { ok: true, rows };
}

/**
 * Names are compared without case, diacritics or spacing: "Katarína" and
 * "katarina" are the same accountant, "Alfa  s.r.o." and "Alfa s.r.o." the same company.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type SheetFacts = {
  rowNumber: number;
  client: string;
  officialName: string;
  /** Eight digits, or "" when the cell is empty. */
  ico: string;
  /** Normalized SK IČ DPH, or "" when the cell is empty. */
  icDph: string;
  dic: string;
  seat: string;
  status: string;
  keeper: string;
  cooperation: string;
  folderId: string;
  /** Why the IČO or IČ DPH is malformed, in the words the profile form uses. */
  problems: string[];
};

/**
 * An empty IČO is not a problem: the row is then reported as having no IČO.
 * A filled one must pass the same checks the profile's register lookup relies on.
 */
export function readFacts(row: ClientSheetRow): SheetFacts {
  const cell = (key: ColumnKey) => row.cells[key].trim();
  const problems: string[] = [];

  const icoDigits = cell("ico").replace(/\s/g, "");
  let ico = "";
  if (icoDigits !== "") {
    if (!/^\d{8}$/.test(icoDigits)) {
      problems.push(`IČO „${icoDigits}“ nemá osem číslic.`);
    } else if (!isValidIcoChecksum(icoDigits)) {
      problems.push(`IČO „${icoDigits}“ nemá platnú kontrolnú číslicu.`);
    } else {
      ico = icoDigits;
    }
  }

  let icDph = "";
  if (cell("icDph") !== "") {
    const check = validateSkIcDph(cell("icDph"));
    if (check.ok) {
      icDph = normalizeSkIcDph(cell("icDph"));
    } else {
      problems.push(check.message);
    }
  }

  return {
    rowNumber: row.rowNumber,
    client: collapse(cell("client")),
    officialName: collapse(cell("officialName")),
    ico,
    icDph,
    dic: cell("dic").replace(/\s/g, ""),
    seat: collapse(cell("seat")),
    status: collapse(cell("status")),
    keeper: collapse(cell("keeper")),
    cooperation: collapse(cell("cooperation")),
    folderId: cell("folderId"),
    problems,
  };
}

/** A company as the match needs it. */
export type MatchCompany = {
  id: number;
  driveFolderId: string;
  name: string;
  groupName: string | null;
  archived: boolean;
};

/**
 * A subject with an IČO as the match and the plan need it (0006/04): a client's profile when
 * `linkedCompanyId` is set, otherwise an Adresár subject that no company holds (an office client,
 * or a counterparty). Its identity values are "" where empty.
 */
export type MatchSubject = {
  id: number;
  country: string;
  ico: string;
  linkedCompanyId: number | null;
  legalName: string;
  address: string;
  dic: string;
  icDph: string;
  officeClient: boolean;
  officeKeeper: string;
  officeCooperation: string;
};

export type MatchedBy = "folder" | "ico" | "name";

type MatchResult = { companyId: number; by: MatchedBy } | { reason: string };

/**
 * One company per row, by the strongest key that names exactly one company:
 * the Drive folder id, then the IČO of a client's profile, then the name.
 * A name only guesses; the preview asks her to confirm it before anything is written.
 * An Adresár subject that no company holds does not name a company: its IČO matters
 * only to the Adresár (see planClientSheet).
 */
export function matchRow(
  facts: SheetFacts,
  companies: readonly MatchCompany[],
  subjects: readonly MatchSubject[],
): MatchResult {
  if (facts.folderId !== "") {
    const byFolder = companies.filter((company) => company.driveFolderId === facts.folderId);
    if (byFolder.length === 1) {
      return { companyId: byFolder[0]!.id, by: "folder" };
    }
  }

  if (facts.ico !== "") {
    const byIco = subjects.filter((subject) => subject.linkedCompanyId !== null && subject.ico === facts.ico);
    if (byIco.length === 1) {
      return { companyId: byIco[0]!.linkedCompanyId!, by: "ico" };
    }
    if (byIco.length > 1) {
      return { reason: `IČO ${facts.ico} patrí viacerým profilom firiem.` };
    }
  }

  const key = normalizeName(facts.client);
  if (key !== "") {
    const byName = companies.filter(
      (company) =>
        normalizeName(companyDisplayName(company.name)) === key || normalizeName(company.name) === key,
    );
    if (byName.length === 1) {
      return { companyId: byName[0]!.id, by: "name" };
    }
    if (byName.length > 1) {
      return { reason: `Názov „${facts.client}“ sedí na viacero firiem.` };
    }
  }

  return { reason: "Nenašla sa firma s týmto ID priečinka, IČO ani názvom." };
}

export const PROFILE_FIELD_LABELS = {
  country: "Krajina",
  legalName: "Právny názov",
  address: "Sídlo",
  ico: "IČO",
  dic: "DIČ",
  icDph: "IČ DPH",
} as const;

export type FieldKey = keyof typeof PROFILE_FIELD_LABELS;

/** The order the fields appear in on the profile and in the preview. */
export const PROFILE_FIELDS: readonly FieldKey[] = ["legalName", "address", "ico", "dic", "icDph", "country"];

export type FieldChange = {
  field: FieldKey;
  label: string;
  /** What the profile holds now; null for a profile that does not exist yet. */
  old: string | null;
  /** What the sheet says. */
  next: string;
  /**
   * "fill": the profile has nothing there, so the sheet's value goes in without a question.
   * "change": the profile holds a different value, so it is written only when ticked. That holds
   * whatever the value's source: a hand-saved one is hers, and a register's or the sheet's own
   * earlier value is still a value she did not see replaced.
   */
  kind: "fill" | "change";
};

/**
 * The office's own data on a subject (0006/04): the sheet's *Vedie* and *Spolupráca*, and for an
 * Adresár subject the office-client flag. The sheet owns these, so they are written without a tick.
 */
export type OfficeField = "officeClient" | "keeper" | "cooperation";

export const OFFICE_FIELD_LABELS: Record<OfficeField, string> = {
  officeClient: "Klient kancelárie",
  keeper: "Vedie",
  cooperation: "Spolupráca",
};

export type OfficeChange = {
  field: OfficeField;
  label: string;
  /** What the subject holds now; null when there is no subject yet. */
  old: string | null;
  next: string;
};

export type RowStatus = "new" | "changed" | "unchanged" | "adresar" | "no-ico" | "invalid" | "unmatched";

export type PlannedRow = {
  rowNumber: number;
  client: string;
  ico: string;
  status: RowStatus;
  /** Why the row is not written, for every status but new, changed, adresar and unchanged. */
  reason: string | null;
  companyId: number | null;
  companyName: string | null;
  matchedBy: MatchedBy | null;
  /** Matched by name only: a guess that is written only once she confirms it. */
  guess: boolean;
  /** The subject's identity now, or null when no subject holds the IČO yet. */
  current: Record<FieldKey, string> | null;
  fields: FieldChange[];
  disagreements: string[];
  /** The sheet's *Vedie* and *Spolupráca*; null where the cell is empty. */
  keeper: string | null;
  cooperation: string | null;
  /** The office data the write changes; never a tick. */
  officeChanges: OfficeChange[];
};

export type ClientSheetPlan = {
  rows: PlannedRow[];
  counts: Record<RowStatus, number> & { guesses: number; disagreements: number };
};

function comparable(field: FieldKey, value: string): string {
  if (field === "ico" || field === "dic") {
    return value.replace(/\s/g, "");
  }
  if (field === "icDph") {
    return value.replace(/\s/g, "").toUpperCase();
  }
  return collapse(value);
}

function isEnded(cooperation: string): boolean {
  return normalizeName(cooperation) === "ukoncena";
}

function isActive(cooperation: string): boolean {
  return normalizeName(cooperation) === "aktivna";
}

function isDissolved(status: string): boolean {
  return normalizeName(status).startsWith("zanikn");
}

/**
 * Where the sheet and the company disagree about the office's own bookkeeping.
 * These are for her to look at: they never block or change a write.
 */
export function disagreementsFor(facts: SheetFacts, company: MatchCompany): string[] {
  const out: string[] = [];
  if (facts.keeper !== "") {
    if (company.groupName === null) {
      out.push(`Vedie „${facts.keeper}“, ale firma nie je v skupine na Drive.`);
    } else if (normalizeName(company.groupName) !== normalizeName(facts.keeper)) {
      out.push(`Vedie „${facts.keeper}“, na Drive je v skupine „${company.groupName}“.`);
    }
  }
  if (isEnded(facts.cooperation) && !company.archived) {
    out.push("Spolupráca je ukončená, ale firma nie je v archíve (skupina Archív).");
  }
  if (isDissolved(facts.status) && isActive(facts.cooperation)) {
    out.push("Stav subjektu je zaniknutý, ale spolupráca je aktívna.");
  }
  return out;
}

function sheetValues(facts: SheetFacts): Record<FieldKey, string> {
  return {
    country: "SK",
    legalName: facts.officialName,
    address: facts.seat,
    ico: facts.ico,
    dic: facts.dic,
    icDph: facts.icDph,
  };
}

/** The fields the sheet would change on this subject; fields the sheet leaves empty are never touched. */
export function fieldChanges(facts: SheetFacts, current: Record<FieldKey, string> | null): FieldChange[] {
  const next = sheetValues(facts);
  const changes: FieldChange[] = [];
  for (const field of PROFILE_FIELDS) {
    const value = next[field];
    if (value === "") {
      continue;
    }
    const old = current ? current[field] : null;
    if (old !== null && comparable(field, old) === comparable(field, value)) {
      continue;
    }
    changes.push({
      field,
      label: PROFILE_FIELD_LABELS[field],
      old,
      next: value,
      kind: old === null || collapse(old) === "" ? "fill" : "change",
    });
  }
  return changes;
}

/**
 * The office data a write changes. A value the subject already holds is no change; the sheet's
 * empty cells change nothing. The office-client flag is set only for an Adresár row (no company).
 */
export function officeChangesOf(facts: SheetFacts, subject: MatchSubject | null, officeClient: boolean): OfficeChange[] {
  const changes: OfficeChange[] = [];
  if (officeClient && !subject?.officeClient) {
    changes.push({
      field: "officeClient",
      label: OFFICE_FIELD_LABELS.officeClient,
      old: subject ? "nie" : null,
      next: "áno",
    });
  }
  const sheet: Array<{ field: "keeper" | "cooperation"; next: string; old: string | undefined }> = [
    { field: "keeper", next: facts.keeper, old: subject?.officeKeeper },
    { field: "cooperation", next: facts.cooperation, old: subject?.officeCooperation },
  ];
  for (const { field, next, old } of sheet) {
    if (next === "" || (old !== undefined && collapse(old) === next)) {
      continue;
    }
    changes.push({ field, label: OFFICE_FIELD_LABELS[field], old: old ?? null, next });
  }
  return changes;
}

function valuesOf(subject: MatchSubject): Record<FieldKey, string> {
  return {
    country: subject.country,
    legalName: subject.legalName,
    address: subject.address,
    ico: subject.ico,
    dic: subject.dic,
    icDph: subject.icDph,
  };
}

/** The name a row is shown by when no company holds it: the sheet's official name, else its client name. */
function sheetDisplayName(facts: SheetFacts): string {
  return facts.officialName || facts.client;
}

/**
 * Plans every row without writing anything. A row is written only when its status is new,
 * changed or adresar; the other statuses say why it is not, and the preview shows them.
 *
 * A row with an IČO that no company holds goes into the Adresár (0006/04): as an office client
 * with the sheet's values, created or updated by (SK, IČO). A row without an IČO is only reported.
 */
export function planClientSheet(
  rows: readonly ClientSheetRow[],
  companies: readonly MatchCompany[],
  subjects: readonly MatchSubject[],
): ClientSheetPlan {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const linkedByCompany = new Map<number, MatchSubject>();
  const unlinkedByIco = new Map<string, MatchSubject>();
  for (const subject of subjects) {
    if (subject.linkedCompanyId !== null) {
      linkedByCompany.set(subject.linkedCompanyId, subject);
    } else if (subject.country === "SK") {
      unlinkedByIco.set(subject.ico, subject);
    }
  }

  const planned: PlannedRow[] = rows.map((row) => {
    const facts = readFacts(row);
    const base = {
      rowNumber: facts.rowNumber,
      client: facts.client,
      ico: facts.ico,
      companyId: null,
      companyName: null,
      matchedBy: null,
      guess: false,
      current: null,
      fields: [],
      disagreements: [],
      keeper: facts.keeper || null,
      cooperation: facts.cooperation || null,
      officeChanges: [],
    } satisfies Omit<PlannedRow, "status" | "reason">;

    const match = matchRow(facts, companies, subjects);
    if ("reason" in match) {
      if (facts.ico === "") {
        return { ...base, status: "unmatched", reason: match.reason };
      }
      if (facts.problems.length > 0) {
        return { ...base, companyName: sheetDisplayName(facts), status: "invalid", reason: facts.problems.join(" ") };
      }
      return planAdresarRow(facts, base, unlinkedByIco);
    }

    const company = companyById.get(match.companyId)!;
    const matched = {
      ...base,
      companyId: company.id,
      companyName: companyDisplayName(company.name),
      matchedBy: match.by,
      guess: match.by === "name",
      disagreements: disagreementsFor(facts, company),
    };

    if (facts.problems.length > 0) {
      return { ...matched, status: "invalid", reason: facts.problems.join(" ") };
    }
    if (facts.ico === "") {
      return { ...matched, status: "no-ico", reason: "Chýba IČO, profil sa nezapíše." };
    }

    const owner = subjects.find(
      (subject) => subject.linkedCompanyId !== null && subject.linkedCompanyId !== company.id && subject.ico === facts.ico,
    );
    if (owner) {
      const ownerCompany = companyById.get(owner.linkedCompanyId!);
      const name = ownerCompany ? companyDisplayName(ownerCompany.name) : "iná firma";
      return {
        ...matched,
        status: "invalid",
        reason: `IČO ${facts.ico} už má profil firmy „${name}“.`,
      };
    }

    // The subject the company's profile will be saved into: its own, or the Adresár subject holding the IČO.
    const linked = linkedByCompany.get(company.id) ?? null;
    const sameIco = unlinkedByIco.get(facts.ico) ?? null;
    if (linked && linked.ico !== facts.ico && sameIco) {
      // A changed IČO would link the company to that subject, and its values would be replaced by hers.
      return {
        ...matched,
        status: "invalid",
        reason: `IČO ${facts.ico} už má v adresári iný subjekt; najprv ho zlúčte.`,
      };
    }

    // Without a linked subject the company has no profile yet: its profile is the Adresár subject
    // holding the IČO (if any), and the write links it. That is a new profile, even when nothing differs.
    const subject = linked ?? sameIco;
    const current = subject ? valuesOf(subject) : null;
    const fields = fieldChanges(facts, current);
    const officeChanges = officeChangesOf(facts, subject, false);
    const status: RowStatus = !linked ? "new" : fields.length > 0 || officeChanges.length > 0 ? "changed" : "unchanged";
    return { ...matched, current, fields, officeChanges, status, reason: null };
  });

  const finalRows = applyDuplicateRules(planned);
  return { rows: finalRows, counts: countPlan(finalRows) };
}

/** An unmatched row with an IČO: an Adresár subject, created or updated, unless it already holds the sheet's values. */
function planAdresarRow(
  facts: SheetFacts,
  base: Omit<PlannedRow, "status" | "reason">,
  unlinkedByIco: ReadonlyMap<string, MatchSubject>,
): PlannedRow {
  const subject = unlinkedByIco.get(facts.ico) ?? null;
  const current = subject ? valuesOf(subject) : null;
  const fields = fieldChanges(facts, current);
  const officeChanges = officeChangesOf(facts, subject, true);
  const changed = !current || fields.length > 0 || officeChanges.length > 0;
  return {
    ...base,
    companyName: sheetDisplayName(facts),
    current,
    fields,
    officeChanges,
    status: changed ? "adresar" : "unchanged",
    reason: null,
  };
}

/**
 * Two sheet rows that would write the same company, or the same IČO, race each other; neither is
 * written. Only rows that would write are counted: a row already refused has nothing to race.
 */
function applyDuplicateRules(planned: PlannedRow[]): PlannedRow[] {
  const rowsPerCompany = new Map<number, number>();
  for (const row of planned) {
    if (row.companyId !== null) {
      rowsPerCompany.set(row.companyId, (rowsPerCompany.get(row.companyId) ?? 0) + 1);
    }
  }
  const afterCompanies = planned.map((row) =>
    row.companyId !== null && (rowsPerCompany.get(row.companyId) ?? 0) > 1
      ? { ...row, status: "invalid" as const, reason: "Firma je v hárku na viacerých riadkoch.", fields: [], officeChanges: [] }
      : row,
  );

  const writable = (row: PlannedRow) =>
    row.ico !== "" && ["new", "changed", "unchanged", "adresar"].includes(row.status);
  const rowsPerIco = new Map<string, number>();
  for (const row of afterCompanies) {
    if (writable(row)) {
      rowsPerIco.set(row.ico, (rowsPerIco.get(row.ico) ?? 0) + 1);
    }
  }
  return afterCompanies.map((row) =>
    writable(row) && (rowsPerIco.get(row.ico) ?? 0) > 1
      ? { ...row, status: "invalid" as const, reason: `IČO ${row.ico} sa v hárku opakuje.`, fields: [], officeChanges: [] }
      : row,
  );
}

function countPlan(rows: readonly PlannedRow[]): ClientSheetPlan["counts"] {
  const counts = {
    new: 0,
    changed: 0,
    unchanged: 0,
    adresar: 0,
    "no-ico": 0,
    invalid: 0,
    unmatched: 0,
    guesses: 0,
    disagreements: 0,
  };
  for (const row of rows) {
    counts[row.status] += 1;
    if (row.guess) {
      counts.guesses += 1;
    }
    counts.disagreements += row.disagreements.length;
  }
  return counts;
}

/** Her decisions in the preview: which name guesses she confirmed, and which hand-saved values she ticked. */
export type ClientSheetDecisions = {
  confirmedRows: number[];
  /** `${rowNumber}:${field}` for each ticked "change" field. */
  tickedFields: string[];
};

export function tickKey(rowNumber: number, field: FieldKey): string {
  return `${rowNumber}:${field}`;
}

/** A write into a client company's profile, which is its subject (0006/01). */
export type ProfileWrite = {
  companyId: number;
  matchedBy: MatchedBy;
  /** Every identity field this write sets: fills, and the changes she ticked. Empty for an office-only write. */
  written: FieldKey[];
  /** The ticked changes, which replace a value she had saved. */
  overwritten: FieldKey[];
  /** The whole profile after the write: the current values, with the written ones replaced. */
  values: Record<FieldKey, string>;
  /** The sheet's Vedie and Spolupráca; each is set only when its field is in `office`. */
  keeper: string | null;
  cooperation: string | null;
  office: OfficeField[];
};

/** A write into the Adresár for an IČO no company holds (0006/04): created, or updated by (SK, IČO). */
export type AdresarWrite = {
  ico: string;
  /** No subject held the IČO yet: it is created as an office client. */
  isNew: boolean;
  written: FieldKey[];
  overwritten: FieldKey[];
  values: Record<FieldKey, string>;
  keeper: string | null;
  cooperation: string | null;
  office: OfficeField[];
};

/**
 * The company writes she has decided on. A "change" is never written unless ticked, and a
 * name guess never unless confirmed. The server runs this again on confirm, so
 * the preview's list is not trusted.
 */
export function selectClientSheetWrites(
  plan: ClientSheetPlan,
  decisions: ClientSheetDecisions,
): ProfileWrite[] {
  const confirmed = new Set(decisions.confirmedRows);
  const ticked = new Set(decisions.tickedFields);
  const writes: ProfileWrite[] = [];

  for (const row of plan.rows) {
    if (row.companyId === null || row.matchedBy === null) {
      continue;
    }
    if (row.status !== "new" && row.status !== "changed") {
      continue;
    }
    if (row.guess && !confirmed.has(row.rowNumber)) {
      continue;
    }

    const chosen = chosenChanges(row, ticked);
    // A new profile is written even when nothing is chosen: the write links the subject to the company.
    if (chosen.length === 0 && row.officeChanges.length === 0 && row.status !== "new") {
      continue;
    }

    const values = { ...blankProfileValues(), ...row.current };
    for (const change of chosen) {
      values[change.field] = change.next;
    }
    writes.push({
      companyId: row.companyId,
      matchedBy: row.matchedBy,
      written: chosen.map((change) => change.field),
      overwritten: chosen.filter((change) => change.kind === "change").map((change) => change.field),
      values,
      keeper: row.keeper,
      cooperation: row.cooperation,
      office: row.officeChanges.map((change) => change.field),
    });
  }
  return writes;
}

/** The Adresár writes she has decided on: an IČO no company holds, with its fills and ticked changes. */
export function selectAdresarWrites(plan: ClientSheetPlan, decisions: ClientSheetDecisions): AdresarWrite[] {
  const ticked = new Set(decisions.tickedFields);
  const writes: AdresarWrite[] = [];

  for (const row of plan.rows) {
    if (row.status !== "adresar") {
      continue;
    }
    const chosen = chosenChanges(row, ticked);
    if (chosen.length === 0 && row.officeChanges.length === 0) {
      continue;
    }

    const values = { ...blankProfileValues(), ...row.current };
    for (const change of chosen) {
      values[change.field] = change.next;
    }
    writes.push({
      ico: row.ico,
      isNew: row.current === null,
      written: chosen.map((change) => change.field),
      overwritten: chosen.filter((change) => change.kind === "change").map((change) => change.field),
      values,
      keeper: row.keeper,
      cooperation: row.cooperation,
      office: row.officeChanges.map((change) => change.field),
    });
  }
  return writes;
}

/** The identity changes she has allowed: every fill, and the changes she ticked. */
function chosenChanges(row: PlannedRow, ticked: ReadonlySet<string>): FieldChange[] {
  return row.fields.filter(
    (change) => change.kind === "fill" || ticked.has(tickKey(row.rowNumber, change.field)),
  );
}

function blankProfileValues(): Record<FieldKey, string> {
  return { country: "SK", legalName: "", address: "", ico: "", dic: "", icDph: "" };
}
