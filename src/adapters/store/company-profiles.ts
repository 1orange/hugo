import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { subjects } from "@/lib/db/schema";
import { getDb, type Db } from "@/lib/db/client";
import { toColumns, toSubject, type SubjectDbRow, type SubjectRow } from "@/adapters/store/subjects";
import {
  PROFILE_FIELDS,
  profileProvenance,
  type CompanyCountry,
  type CompanyProfileFields,
  type ProfileField,
  type ProfileValues,
} from "@/modules/company-profile";
import type { SubjectField } from "@/modules/subject-directory";

/**
 * A client company's profile is the Adresár subject linked to it (ADR 0022, amended
 * 2026-11-16): there is no second copy. Reads return the profile's shape from that
 * subject; a save writes the subject and links it.
 */

export type CompanyProfileRow = CompanyProfileFields & { companyId: number };

/** The database, or the transaction a caller already runs its writes in. */
export type ProfileWriter = Pick<Db, "select" | "insert" | "update">;

/** A save of the IČO that another company's profile already holds: refused, not moved. */
export class ProfileIcoTakenError extends Error {
  constructor() {
    super("IČO už patrí profilu inej firmy.");
    this.name = "ProfileIcoTakenError";
  }
}

function profileOf(row: SubjectDbRow): CompanyProfileRow {
  return {
    // Only called for a row linked to a company.
    companyId: row.linkedCompanyId as number,
    country: row.country as CompanyCountry,
    legalName: row.legalName ?? "",
    address: row.address ?? "",
    ico: row.ico ?? "",
    dic: row.dic ?? "",
    icDph: row.icDph ?? "",
    registerSource: row.profileRegisterSource ?? "manual",
    savedAt: row.profileSavedAt ?? row.createdAt,
  };
}

export async function getCompanyProfile(companyId: number): Promise<CompanyProfileRow | null> {
  const [row] = await getDb()
    .select()
    .from(subjects)
    .where(eq(subjects.linkedCompanyId, companyId))
    .limit(1);
  return row ? profileOf(row) : null;
}

export async function listCompanyProfiles(): Promise<CompanyProfileRow[]> {
  const rows = await getDb().select().from(subjects).where(isNotNull(subjects.linkedCompanyId));
  return rows.map(profileOf);
}

export async function listCompanyIdsWithoutProfile(companyIds: readonly number[]): Promise<Set<number>> {
  if (companyIds.length === 0) {
    return new Set();
  }
  const linked = await getDb()
    .select({ companyId: subjects.linkedCompanyId })
    .from(subjects)
    .where(inArray(subjects.linkedCompanyId, [...companyIds]));
  const have = new Set(linked.map((row) => row.companyId));
  return new Set(companyIds.filter((id) => !have.has(id)));
}

/**
 * Saves a client's profile into its subject, which is created or found by (country, IČO)
 * and linked to the company. Pass `writer` to write inside a transaction the caller runs.
 *
 * `typed` lists the identity fields she typed; a changed value she did not type takes the
 * register's source when the lookup gave it (see profileProvenance). A company whose IČO
 * changes is unlinked from its old subject, which stays in the Adresár.
 */
export async function saveCompanyProfile(
  companyId: number,
  profile: CompanyProfileFields,
  typed: readonly ProfileField[] = [],
  writer?: ProfileWriter,
): Promise<CompanyProfileRow> {
  if (writer) {
    return writeProfile(writer, companyId, profile, typed);
  }
  return getDb().transaction((tx) => writeProfile(tx, companyId, profile, typed));
}

function valuesOf(subject: SubjectRow): ProfileValues {
  return {
    legalName: subject.legalName ?? "",
    address: subject.address ?? "",
    dic: subject.dic ?? "",
    icDph: subject.icDph ?? "",
  };
}

async function writeProfile(
  db: ProfileWriter,
  companyId: number,
  profile: CompanyProfileFields,
  typed: readonly ProfileField[],
): Promise<CompanyProfileRow> {
  const [found] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.country, profile.country), eq(subjects.ico, profile.ico)))
    .limit(1);
  if (found && found.linkedCompanyId !== null && found.linkedCompanyId !== companyId) {
    throw new ProfileIcoTakenError();
  }
  const previous = found ? toSubject(found) : null;

  // Unlink first: the company's former subject (a changed IČO) must not hold the link when the new one takes it.
  await db
    .update(subjects)
    .set({ linkedCompanyId: null })
    .where(and(eq(subjects.linkedCompanyId, companyId), found ? ne(subjects.id, found.id) : undefined));

  const next: ProfileValues = {
    legalName: profile.legalName.trim(),
    address: profile.address.trim(),
    dic: profile.dic.trim(),
    icDph: profile.icDph.trim(),
  };
  const provenance = profileProvenance({
    previous: previous ? { values: valuesOf(previous), sources: previous.sources } : null,
    next,
    registerSource: profile.registerSource,
    typed,
  });

  const isIdentityField = (field: string) => (PROFILE_FIELDS as readonly string[]).includes(field);
  const sources = Object.fromEntries(
    Object.entries(previous?.sources ?? {}).filter(([field]) => !isIdentityField(field)),
  ) as SubjectRow["sources"];
  Object.assign(sources, provenance.sources);
  const manualFields: SubjectField[] = [
    ...(previous?.manualFields ?? []).filter((field) => !isIdentityField(field)),
    ...PROFILE_FIELDS.filter((field) => provenance.sources[field] === "manual"),
  ];
  const changed = provenance.changed as readonly SubjectField[];
  const findings = (previous?.findings ?? []).filter(
    (finding) => !(finding.kind === "register-disagrees" && changed.includes(finding.field)),
  );

  const vatSource = profile.country === "SK" ? next.icDph : next.dic;
  const columns = toColumns({
    legalName: next.legalName || null,
    address: next.address || null,
    dic: next.dic || null,
    icDph: next.icDph || null,
    vatId: vatSource.replace(/\s+/g, "").toUpperCase() || null,
    sources,
    manualFields,
    findings,
    linkedCompanyId: companyId,
    lastSeenAt: profile.savedAt,
  });

  if (found) {
    await db
      .update(subjects)
      .set({
        ...columns,
        profileRegisterSource: profile.registerSource,
        profileSavedAt: profile.savedAt,
      })
      .where(eq(subjects.id, found.id));
  } else {
    await db.insert(subjects).values({
      country: profile.country,
      ico: profile.ico,
      ...columns,
      lastSeenAt: profile.savedAt,
      createdAt: profile.savedAt,
      profileRegisterSource: profile.registerSource,
      profileSavedAt: profile.savedAt,
    });
  }

  return {
    companyId,
    country: profile.country,
    legalName: next.legalName,
    address: next.address,
    ico: profile.ico,
    dic: next.dic,
    icDph: next.icDph,
    registerSource: profile.registerSource,
    savedAt: profile.savedAt,
  };
}
