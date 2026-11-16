import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  companies,
  documents,
  files,
  subjectAliases,
  subjectAliasSightings,
  subjects,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { ViesRecord } from "@/modules/subject-directory";

/**
 * The shared subject directory (ADR 0022). Rows are plain values here; what a
 * refresh or a correction may change is the service's rule, not the store's.
 */

export type SubjectCountry = "SK" | "CZ" | "foreign";
export type SubjectRegisterStatus = "active" | "dissolved" | "unknown";
/** A value the directory holds, and where it came from (see the module's SubjectSource). */
export type SubjectSource = "register" | "vies" | "manual" | "sheet";
/** The fields a register, VIES or an accountant can set. */
export type SubjectField =
  | "legalName"
  | "formerNames"
  | "dic"
  | "icDph"
  | "address"
  | "registerStatus"
  | "vatGroupId";

export type SubjectFinding = {
  field: SubjectField;
  /** A fresh register answer differs from a manual value. */
  kind: "register-disagrees";
  /** The value the other side holds. */
  value: string;
  at: string;
};

export type SubjectRow = {
  id: number;
  country: SubjectCountry;
  ico: string | null;
  vatId: string | null;
  legalName: string | null;
  formerNames: string[];
  dic: string | null;
  icDph: string | null;
  address: string | null;
  registerStatus: SubjectRegisterStatus;
  /** VAT-group membership, where known: the group's normalised VAT ID. */
  vatGroupId: string | null;
  /** VIES's answers, by the normalised VAT ID they were asked about. */
  viesStatus: Record<string, ViesRecord>;
  sources: Partial<Record<SubjectField, SubjectSource>>;
  manualFields: SubjectField[];
  findings: SubjectFinding[];
  linkedCompanyId: number | null;
  /** An office client (0006/04): a client of the office with no company in Hugo. */
  officeClient: boolean;
  /** *Vedie* and *Spolupráca* from the client sheet; null where the sheet never said. */
  officeKeeper: string | null;
  officeCooperation: string | null;
  verifiedAt: string | null;
  lastSeenAt: string;
  createdAt: string;
};

export type SubjectPatch = Partial<
  Pick<
    SubjectRow,
    | "legalName"
    | "formerNames"
    | "dic"
    | "icDph"
    | "address"
    | "registerStatus"
    | "vatGroupId"
    | "viesStatus"
    | "sources"
    | "manualFields"
    | "findings"
    | "linkedCompanyId"
    | "officeClient"
    | "officeKeeper"
    | "officeCooperation"
    | "verifiedAt"
    | "lastSeenAt"
    | "ico"
    | "vatId"
  >
>;

export type SubjectAliasRow = {
  subjectId: number;
  normalizedName: string;
  displayName: string;
  count: number;
  lastSeenAt: string;
};

export type SubjectDbRow = typeof subjects.$inferSelect;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** A stored row as the directory's values; the client profile store reads its own columns from the row. */
export function toSubject(row: SubjectDbRow): SubjectRow {
  return {
    id: row.id,
    country: row.country as SubjectCountry,
    ico: row.ico,
    vatId: row.vatId,
    legalName: row.legalName,
    formerNames: parseJson<string[]>(row.formerNamesJson, []),
    dic: row.dic,
    icDph: row.icDph,
    address: row.address,
    registerStatus: row.registerStatus as SubjectRegisterStatus,
    vatGroupId: row.vatGroupId,
    viesStatus: parseJson<SubjectRow["viesStatus"]>(row.viesStatus ?? "{}", {}),
    sources: parseJson<SubjectRow["sources"]>(row.sourcesJson, {}),
    manualFields: parseJson<SubjectField[]>(row.manualFieldsJson, []),
    findings: parseJson<SubjectFinding[]>(row.findingsJson, []),
    linkedCompanyId: row.linkedCompanyId,
    officeClient: row.officeClient,
    officeKeeper: row.officeKeeper,
    officeCooperation: row.officeCooperation,
    verifiedAt: row.verifiedAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  };
}

export function toColumns(patch: SubjectPatch): Partial<typeof subjects.$inferInsert> {
  const columns: Partial<typeof subjects.$inferInsert> = {};
  if (patch.ico !== undefined) columns.ico = patch.ico;
  if (patch.vatId !== undefined) columns.vatId = patch.vatId;
  if (patch.legalName !== undefined) columns.legalName = patch.legalName;
  if (patch.formerNames !== undefined) columns.formerNamesJson = JSON.stringify(patch.formerNames);
  if (patch.dic !== undefined) columns.dic = patch.dic;
  if (patch.icDph !== undefined) columns.icDph = patch.icDph;
  if (patch.address !== undefined) columns.address = patch.address;
  if (patch.registerStatus !== undefined) columns.registerStatus = patch.registerStatus;
  if (patch.vatGroupId !== undefined) columns.vatGroupId = patch.vatGroupId;
  if (patch.viesStatus !== undefined) columns.viesStatus = JSON.stringify(patch.viesStatus);
  if (patch.sources !== undefined) columns.sourcesJson = JSON.stringify(patch.sources);
  if (patch.manualFields !== undefined) columns.manualFieldsJson = JSON.stringify(patch.manualFields);
  if (patch.findings !== undefined) columns.findingsJson = JSON.stringify(patch.findings);
  if (patch.linkedCompanyId !== undefined) columns.linkedCompanyId = patch.linkedCompanyId;
  if (patch.officeClient !== undefined) columns.officeClient = patch.officeClient;
  if (patch.officeKeeper !== undefined) columns.officeKeeper = patch.officeKeeper;
  if (patch.officeCooperation !== undefined) columns.officeCooperation = patch.officeCooperation;
  if (patch.verifiedAt !== undefined) columns.verifiedAt = patch.verifiedAt;
  if (patch.lastSeenAt !== undefined) columns.lastSeenAt = patch.lastSeenAt;
  return columns;
}

export async function getSubject(id: number): Promise<SubjectRow | null> {
  const [row] = await getDb().select().from(subjects).where(eq(subjects.id, id)).limit(1);
  return row ? toSubject(row) : null;
}

export async function findSubjectByIco(country: SubjectCountry, ico: string): Promise<SubjectRow | null> {
  const [row] = await getDb()
    .select()
    .from(subjects)
    .where(and(eq(subjects.country, country), eq(subjects.ico, ico)))
    .limit(1);
  return row ? toSubject(row) : null;
}

/** The Slovak and Czech subjects holding this IČO: one is the answer, more is a collision. */
export async function findSubjectsByIco(ico: string): Promise<SubjectRow[]> {
  const rows = await getDb()
    .select()
    .from(subjects)
    .where(and(eq(subjects.ico, ico), sql`${subjects.country} <> 'foreign'`))
    .limit(2);
  return rows.map(toSubject);
}

/** The subject a client company's profile is (ADR 0022, amended 2026-11-16), or null for a company without one. */
export async function getSubjectLinkedTo(companyId: number): Promise<SubjectRow | null> {
  const [row] = await getDb().select().from(subjects).where(eq(subjects.linkedCompanyId, companyId)).limit(1);
  return row ? toSubject(row) : null;
}

/** The register's standing of each listed company's linked subject, where a company has one. */
export async function listClientRegisterStatuses(companyIds: readonly number[]): Promise<Map<number, SubjectRegisterStatus>> {
  if (companyIds.length === 0) {
    return new Map();
  }
  const rows = await getDb()
    .select({ companyId: subjects.linkedCompanyId, registerStatus: subjects.registerStatus })
    .from(subjects)
    .where(inArray(subjects.linkedCompanyId, [...companyIds]));
  return new Map(rows.map((row) => [row.companyId as number, row.registerStatus as SubjectRegisterStatus]));
}

/** By VAT ID, whatever the IČO column holds: a subject learned with its IČO keeps its VAT ID. */
export async function findSubjectByVatId(vatId: string): Promise<SubjectRow | null> {
  const [row] = await getDb()
    .select()
    .from(subjects)
    .where(eq(subjects.vatId, vatId))
    .orderBy(asc(subjects.id))
    .limit(1);
  return row ? toSubject(row) : null;
}

/** Subjects printed under this name (normalised), the most often seen first. */
export async function findSubjectsByAlias(
  normalizedName: string,
): Promise<Array<{ subject: SubjectRow; count: number }>> {
  const rows = await getDb()
    .select({ subject: subjects, count: subjectAliases.count })
    .from(subjectAliases)
    .innerJoin(subjects, eq(subjects.id, subjectAliases.subjectId))
    .where(eq(subjectAliases.normalizedName, normalizedName))
    .orderBy(desc(subjectAliases.count), asc(subjects.id));
  return rows.map((row) => ({ subject: toSubject(row.subject), count: row.count }));
}

export async function insertSubject(input: {
  country: SubjectCountry;
  ico: string | null;
  vatId: string | null;
  legalName?: string | null;
  formerNames?: string[];
  dic?: string | null;
  icDph?: string | null;
  address?: string | null;
  registerStatus?: SubjectRegisterStatus;
  sources?: SubjectRow["sources"];
  verifiedAt?: string | null;
  linkedCompanyId?: number | null;
  now: string;
}): Promise<SubjectRow> {
  const [row] = await getDb()
    .insert(subjects)
    .values({
      country: input.country,
      ico: input.ico,
      vatId: input.vatId,
      legalName: input.legalName ?? null,
      formerNamesJson: JSON.stringify(input.formerNames ?? []),
      dic: input.dic ?? null,
      icDph: input.icDph ?? null,
      address: input.address ?? null,
      registerStatus: input.registerStatus ?? "unknown",
      sourcesJson: JSON.stringify(input.sources ?? {}),
      verifiedAt: input.verifiedAt ?? null,
      linkedCompanyId: input.linkedCompanyId ?? null,
      lastSeenAt: input.now,
      createdAt: input.now,
    })
    .returning();
  return toSubject(row!);
}

export async function updateSubject(id: number, patch: SubjectPatch): Promise<SubjectRow | null> {
  const columns = toColumns(patch);
  if (Object.keys(columns).length === 0) {
    return getSubject(id);
  }
  const [row] = await getDb().update(subjects).set(columns).where(eq(subjects.id, id)).returning();
  return row ? toSubject(row) : null;
}

/**
 * Counts a name under a subject once per document (ADR 0022): the first time a
 * document shows it, the count goes up; checking that document again only moves
 * the last sighting. The first spelling seen is the display name.
 */
export async function recordAliasSighting(input: {
  subjectId: number;
  normalizedName: string;
  displayName: string;
  documentId: string;
  now: string;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const first = await tx
      .insert(subjectAliasSightings)
      .values({
        subjectId: input.subjectId,
        normalizedName: input.normalizedName,
        documentId: input.documentId,
        sightedAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ documentId: subjectAliasSightings.documentId });
    const counted = first.length > 0;
    await tx
      .insert(subjectAliases)
      .values({
        subjectId: input.subjectId,
        normalizedName: input.normalizedName,
        displayName: input.displayName,
        count: counted ? 1 : 0,
        lastSeenAt: input.now,
      })
      .onConflictDoUpdate({
        target: [subjectAliases.subjectId, subjectAliases.normalizedName],
        set: {
          count: counted ? sql`${subjectAliases.count} + 1` : sql`${subjectAliases.count}`,
          lastSeenAt: input.now,
        },
      });
  });
}

export async function listSubjectAliases(subjectId: number): Promise<SubjectAliasRow[]> {
  return getDb()
    .select()
    .from(subjectAliases)
    .where(eq(subjectAliases.subjectId, subjectId))
    .orderBy(desc(subjectAliases.count), asc(subjectAliases.normalizedName));
}

/** Every subject, the most recently seen first: the directory screen searches and pages these. */
export async function listAllSubjects(): Promise<SubjectRow[]> {
  const rows = await getDb()
    .select()
    .from(subjects)
    .orderBy(desc(subjects.lastSeenAt), asc(subjects.id));
  return rows.map(toSubject);
}

/** Every alias of every subject, for the directory's search. */
export async function listAllSubjectAliases(): Promise<SubjectAliasRow[]> {
  return getDb().select().from(subjectAliases).orderBy(asc(subjectAliases.subjectId), desc(subjectAliases.count));
}

export type SubjectReference = {
  documentId: string;
  companyId: number;
  companyName: string;
  monthKey: string;
  fileName: string;
  driveFileId: string;
};

/**
 * The documents a subject was sighted on, through the names it was printed under
 * (ADR 0022: the referencing documents are listed so a correction's impact can be
 * judged). Deleted files are left out; the newest month first.
 */
export async function listSubjectReferences(subjectId: number): Promise<SubjectReference[]> {
  const rows = await getDb()
    .selectDistinct({
      documentId: documents.id,
      companyId: documents.companyId,
      companyName: companies.name,
      monthKey: documents.monthKey,
      fileName: files.name,
      driveFileId: documents.driveFileId,
    })
    .from(subjectAliasSightings)
    .innerJoin(documents, eq(documents.id, subjectAliasSightings.documentId))
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .innerJoin(files, eq(files.driveFileId, documents.driveFileId))
    .where(and(eq(subjectAliasSightings.subjectId, subjectId), eq(files.deleted, false)))
    .orderBy(desc(documents.monthKey), asc(documents.id));
  return rows;
}
