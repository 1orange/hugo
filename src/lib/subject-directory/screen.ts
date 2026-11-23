import {
  getSubject,
  getSubjectLinkedTo,
  listAllSubjectAliases,
  listAllSubjects,
  listSubjectAliases,
  listSubjectReferences,
  type SubjectAliasRow,
  type SubjectRow,
} from "@/adapters/store/subjects";
import { getCompanyById } from "@/adapters/store/companies";
import { companyDisplayName } from "@/modules/company-display-name";
import { formatDateTime, monthLabel } from "@/modules/format-sk";
import {
  identityRowsOf,
  identitySummary,
  type IdentityRow,
  type IdentitySummary,
} from "@/modules/identity-states";
import { searchSubjects } from "@/modules/subject-search";
import { isClientSubject } from "@/modules/subject-directory";
import { verdictLabel, type IntegrityVerdict } from "@/modules/subject-integrity";
import {
  correctableFieldLabel,
  directoryFindingMessage,
  registerStatusLabelOf,
  sourceLabel,
  subjectVerdictOf,
  verdictToneOf,
  viesStatusLabel,
  type CorrectableSubjectField,
} from "@/modules/subject-screen";

/**
 * The read side of the *Adresár* screens (ADR 0022, ADR 0015): what the list and the
 * detail show about each subject. Reads the directory only; no register is asked.
 */

/** How many subjects the list shows; it says how many matched in all. */
export const DIRECTORY_PAGE_SIZE = 100;

export type VerdictTone = "good" | "warn" | "bad" | "neutral";

export type DirectoryListRow = {
  id: number;
  country: string;
  name: string;
  ico: string | null;
  dic: string | null;
  icDph: string | null;
  verdict: IntegrityVerdict;
  verdictLabel: string;
  verdictTone: VerdictTone;
  lastSeenLabel: string;
  /**
   * Set for a client's subject: `href` is the company it is (its profile is this record), and null
   * for an office client that no company holds (0006/04).
   */
  client: { href: string | null } | null;
  /** The office's own data (0006/04): *Vedie* and *Spolupráca* from the client sheet. */
  keeper: string | null;
  cooperation: string | null;
  /** How many of the identity fields are overené, upravené ručne and neoverené. */
  identity: IdentitySummary;
};

export type DirectoryList = {
  query: string;
  /** Only the clients' subjects were asked for. */
  clientsOnly: boolean;
  rows: DirectoryListRow[];
  /** Every subject that matched, not just the rows shown. */
  total: number;
};

function verdictOf(subject: SubjectRow): { verdict: IntegrityVerdict; label: string; tone: VerdictTone } {
  const verdict = subjectVerdictOf(subject);
  return { verdict, label: verdictLabel(verdict), tone: verdictToneOf(verdict) };
}

function groupAliases(aliases: SubjectAliasRow[]): Map<number, SubjectAliasRow[]> {
  const grouped = new Map<number, SubjectAliasRow[]>();
  for (const alias of aliases) {
    grouped.set(alias.subjectId, [...(grouped.get(alias.subjectId) ?? []), alias]);
  }
  return grouped;
}

/**
 * The subjects matching the query, most recently seen first; `rows` holds at most `limit`.
 * With `clientsOnly`, only the clients: a client company's profile and the office clients.
 */
export async function listSubjectDirectory(
  query: string | null | undefined,
  limit: number = DIRECTORY_PAGE_SIZE,
  options: { clientsOnly?: boolean } = {},
): Promise<DirectoryList> {
  const [allSubjects, aliases] = await Promise.all([listAllSubjects(), listAllSubjectAliases()]);
  const subjects = options.clientsOnly ? allSubjects.filter(isClientSubject) : allSubjects;
  const aliasesBySubject = groupAliases(aliases);
  const searchable = subjects.map((subject) => ({
    subject,
    aliases: (aliasesBySubject.get(subject.id) ?? []).map((alias) => alias.displayName),
  }));
  const { rows, total } = searchSubjects(
    searchable.map(({ subject, aliases: names }) => ({
      id: subject.id,
      legalName: subject.legalName,
      formerNames: subject.formerNames,
      aliases: names,
      ico: subject.ico,
      dic: subject.dic,
      icDph: subject.icDph,
      vatId: subject.vatId,
    })),
    query,
    limit,
  );
  const byId = new Map(searchable.map((entry) => [entry.subject.id, entry]));
  return {
    query: (query ?? "").trim(),
    clientsOnly: options.clientsOnly === true,
    total,
    rows: rows.map((match) => {
      const { subject, aliases: names } = byId.get(match.id)!;
      const verdict = verdictOf(subject);
      return {
        id: subject.id,
        country: subject.country,
        name: subject.legalName ?? names[0] ?? "Bez názvu v registri",
        ico: subject.ico,
        dic: subject.dic,
        icDph: subject.icDph,
        verdict: verdict.verdict,
        verdictLabel: verdict.label,
        verdictTone: verdict.tone,
        lastSeenLabel: formatDateTime(subject.lastSeenAt),
        client: isClientSubject(subject)
          ? {
              href: subject.linkedCompanyId === null ? null : `/companies/${subject.linkedCompanyId}/activity`,
            }
          : null,
        keeper: subject.officeKeeper,
        cooperation: subject.officeCooperation,
        identity: identitySummary(identityRowsOf(subject)),
      };
    }),
  };
}

export type DetailField = {
  field: CorrectableSubjectField | "ico" | "country" | "registerStatus";
  label: string;
  /** What the field holds; null when nothing does. */
  value: string | null;
  sourceLabel: string;
  /** Her correction, which a register refresh never overwrites. */
  manual: boolean;
  /** Whether she can correct the field on the screen. */
  correctable: boolean;
  /** The identity state of an identity field (IČO, name, address, DIČ, IČ DPH); absent for the others. */
  identity?: IdentityRow;
};

export type SubjectDetail = {
  id: number;
  country: string;
  ico: string | null;
  legalName: string | null;
  verdict: IntegrityVerdict;
  verdictLabel: string;
  verdictTone: VerdictTone;
  registerStatusLabel: string;
  verifiedAtLabel: string;
  lastSeenLabel: string;
  fields: DetailField[];
  formerNames: string[];
  aliases: Array<{ displayName: string; count: number }>;
  findings: Array<{ field: string; kind: string; message: string }>;
  vies: Array<{ vatId: string; label: string; checkedLabel: string }>;
  linkedCompany: { id: number; name: string; href: string } | null;
  /** The office's data on the subject (0006/04). */
  office: { client: boolean; keeper: string | null; cooperation: string | null };
  references: {
    companies: Array<{ id: number; name: string; href: string }>;
    documents: Array<{
      documentId: string;
      fileName: string;
      companyName: string;
      monthLabel: string;
      href: string;
    }>;
  };
};

const CORRECTABLE_FIELDS: readonly CorrectableSubjectField[] = ["legalName", "address", "dic", "icDph", "vatGroupId"];

/** The fields the detail shows, in the order a reader checks them. */
function fieldsOf(subject: SubjectRow): DetailField[] {
  const identity: DetailField[] = [
    { field: "ico", label: "IČO", value: subject.ico, sourceLabel: "—", manual: false, correctable: false },
    { field: "country", label: "Krajina", value: subject.country, sourceLabel: "—", manual: false, correctable: false },
  ];
  const corrected: DetailField[] = CORRECTABLE_FIELDS.map((field) => ({
    field,
    label: correctableFieldLabel(field),
    value: subject[field] ?? null,
    sourceLabel: sourceLabel(subject.sources[field]),
    manual: subject.manualFields.includes(field),
    correctable: true,
  }));
  const status: DetailField = {
    field: "registerStatus",
    label: "Stav v registri",
    value: registerStatusLabelOf(subject.registerStatus),
    sourceLabel: sourceLabel(subject.sources.registerStatus),
    manual: false,
    correctable: false,
  };
  return [...identity, ...corrected, status];
}

/** A client company's identity as its profile page shows it: the states, the register's standing, VIES. */
export type ProfileIdentity = {
  subjectId: number;
  verifiedAtLabel: string;
  registerStatusLabel: string;
  rows: IdentityRow[];
  vies: Array<{ vatId: string; label: string; checkedLabel: string }>;
};

/** The identity states of a client company's profile (its linked subject), or null for a company without one. */
export async function loadProfileIdentity(companyId: number): Promise<ProfileIdentity | null> {
  const subject = await getSubjectLinkedTo(companyId);
  if (!subject) {
    return null;
  }
  return {
    subjectId: subject.id,
    verifiedAtLabel: subject.verifiedAt ? formatDateTime(subject.verifiedAt) : "nikdy",
    registerStatusLabel: registerStatusLabelOf(subject.registerStatus),
    rows: identityRowsOf(subject),
    vies: Object.entries(subject.viesStatus).map(([vatId, record]) => ({
      vatId,
      label: viesStatusLabel(record),
      checkedLabel: formatDateTime(record.checkedAt),
    })),
  };
}

/** Where a subject is shown and what it holds, or null when there is no such subject. */
export async function loadSubjectDetail(
  subjectId: number,
  /** The companies the viewer may see (ADR 0023). The directory is office-wide; its references to companies are not. */
  visibleCompanyIds?: ReadonlySet<number>,
): Promise<SubjectDetail | null> {
  const subject = await getSubject(subjectId);
  if (!subject) {
    return null;
  }
  const [aliases, allReferences, linked] = await Promise.all([
    listSubjectAliases(subjectId),
    listSubjectReferences(subjectId),
    subject.linkedCompanyId === null ? null : getCompanyById(subject.linkedCompanyId),
  ]);
  const references = visibleCompanyIds
    ? allReferences.filter((reference) => visibleCompanyIds.has(reference.companyId))
    : allReferences;

  const verdict = verdictOf(subject);
  const companies = new Map<number, string>();
  for (const reference of references) {
    companies.set(reference.companyId, companyDisplayName(reference.companyName));
  }

  const identityByField = new Map(identityRowsOf(subject).map((row) => [row.field, row]));
  return {
    id: subject.id,
    country: subject.country,
    ico: subject.ico,
    legalName: subject.legalName,
    verdict: verdict.verdict,
    verdictLabel: verdict.label,
    verdictTone: verdict.tone,
    registerStatusLabel: registerStatusLabelOf(subject.registerStatus),
    verifiedAtLabel: subject.verifiedAt ? formatDateTime(subject.verifiedAt) : "nikdy",
    lastSeenLabel: formatDateTime(subject.lastSeenAt),
    fields: fieldsOf(subject).map((field) => ({
      ...field,
      identity: identityByField.get(field.field as IdentityRow["field"]),
    })),
    formerNames: subject.formerNames,
    aliases: aliases.map((alias) => ({ displayName: alias.displayName, count: alias.count })),
    findings: subject.findings.map((finding) => ({
      field: finding.field,
      kind: finding.kind,
      message: directoryFindingMessage(finding),
    })),
    vies: Object.entries(subject.viesStatus).map(([vatId, record]) => ({
      vatId,
      label: viesStatusLabel(record),
      checkedLabel: formatDateTime(record.checkedAt),
    })),
    linkedCompany: linked
      ? { id: linked.id, name: companyDisplayName(linked.name), href: `/companies/${linked.id}/activity` }
      : null,
    office: { client: subject.officeClient, keeper: subject.officeKeeper, cooperation: subject.officeCooperation },
    references: {
      companies: [...companies.entries()].map(([id, name]) => ({ id, name, href: `/companies/${id}/activity` })),
      documents: references.map((reference) => ({
        documentId: reference.documentId,
        fileName: reference.fileName,
        companyName: companyDisplayName(reference.companyName),
        monthLabel: monthLabel(reference.monthKey),
        href: `/companies/${reference.companyId}/${reference.monthKey}?doc=${encodeURIComponent(reference.documentId)}`,
      })),
    },
  };
}
