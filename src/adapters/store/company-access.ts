import { and, eq } from "drizzle-orm";
import { companies, companyPrincipals } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { AccessPrincipal, PrincipalType } from "@/modules/company-access";

/** A company with what is known of who sees its folder: its principals and how the last read went. */
export type CompanyAccess = {
  companyId: number;
  name: string;
  groupName: string | null;
  principals: AccessPrincipal[];
  /** When the sharing was last read successfully; null before the first success. */
  refreshedAt: string | null;
  /** The failure of the last read, if it failed; the principals are then from before it. */
  error: string | null;
};

type PrincipalRow = typeof companyPrincipals.$inferSelect;

function toPrincipal(row: PrincipalRow): AccessPrincipal {
  return {
    type: row.type as PrincipalType,
    email: row.email,
    domain: row.domain,
    role: row.role,
    inherited: row.inherited,
  };
}

/** The principals a company's folder is shared with, as of its last successful read. */
export async function listCompanyPrincipals(companyId: number): Promise<AccessPrincipal[]> {
  const rows = await getDb().select().from(companyPrincipals).where(eq(companyPrincipals.companyId, companyId));
  return rows.map(toPrincipal);
}

/**
 * Replaces a company's principals with the ones just read, and clears its error.
 * One transaction: a reader sees the old set or the new one, never a half.
 */
export async function replaceCompanyPrincipals(
  companyId: number,
  principals: readonly AccessPrincipal[],
  refreshedAt: string,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(companyPrincipals).where(eq(companyPrincipals.companyId, companyId));
    if (principals.length > 0) {
      await tx.insert(companyPrincipals).values(
        principals.map((principal) => ({
          companyId,
          type: principal.type,
          email: principal.email,
          domain: principal.domain,
          role: principal.role,
          inherited: principal.inherited,
        })),
      );
    }
    await tx
      .update(companies)
      .set({ accessRefreshedAt: refreshedAt, accessError: null })
      .where(eq(companies.id, companyId));
  });
}

/**
 * Records that the last read of a company's sharing failed. The principals and
 * the refresh time of the last success stay as they were.
 */
export async function recordCompanyAccessError(companyId: number, message: string): Promise<void> {
  await getDb().update(companies).set({ accessError: message }).where(eq(companies.id, companyId));
}

/** Every active company with its sharing state, for the settings screen. */
export async function listCompaniesAccess(): Promise<CompanyAccess[]> {
  const db = getDb();
  const companyRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      groupName: companies.groupName,
      refreshedAt: companies.accessRefreshedAt,
      error: companies.accessError,
    })
    .from(companies)
    .where(eq(companies.active, true));
  const principalRows = await db.select().from(companyPrincipals);

  const byCompany = new Map<number, AccessPrincipal[]>();
  for (const row of principalRows) {
    const list = byCompany.get(row.companyId) ?? [];
    list.push(toPrincipal(row));
    byCompany.set(row.companyId, list);
  }

  return companyRows
    .map((row) => ({
      companyId: row.id,
      name: row.name,
      groupName: row.groupName,
      principals: byCompany.get(row.id) ?? [],
      refreshedAt: row.refreshedAt,
      error: row.error,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** One row per principal of an active company; a company with none still has one row, with a null principal. */
export type CompanyAccessRow = {
  companyId: number;
  /** When the sharing was last read successfully; null before the first success. */
  accessRefreshedAt: string | null;
  principal: AccessPrincipal | null;
};

/**
 * Active companies with their snapshot and principals, in one query. This is
 * all the visibility guard reads: it never calls Drive (PRD 0007). With an id,
 * only that company's rows.
 */
export async function listCompanyAccessRows(companyId?: number): Promise<CompanyAccessRow[]> {
  const active = eq(companies.active, true);
  const rows = await getDb()
    .select({
      companyId: companies.id,
      accessRefreshedAt: companies.accessRefreshedAt,
      principal: companyPrincipals,
    })
    .from(companies)
    .leftJoin(companyPrincipals, eq(companyPrincipals.companyId, companies.id))
    .where(companyId === undefined ? active : and(active, eq(companies.id, companyId)));
  return rows.map((row) => ({
    companyId: row.companyId,
    accessRefreshedAt: row.accessRefreshedAt,
    principal: row.principal ? toPrincipal(row.principal) : null,
  }));
}
