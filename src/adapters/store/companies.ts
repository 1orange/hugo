import { companies } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";

export type CompanyRow = {
  id: number;
  driveFolderId: string;
  name: string;
  active: boolean;
};

export async function listCompanies(): Promise<CompanyRow[]> {
  const db = getDb();
  return db.select().from(companies).where(eq(companies.active, true));
}

export async function upsertCompany(
  driveFolderId: string,
  name: string,
): Promise<CompanyRow> {
  const db = getDb();
  // One statement, so two sweeps racing on a new folder get the same row.
  const [row] = await db
    .insert(companies)
    .values({ driveFolderId, name, active: true })
    .onConflictDoUpdate({ target: companies.driveFolderId, set: { name } })
    .returning();
  return row!;
}

export async function getCompanyById(id: number): Promise<CompanyRow | null> {
  const db = getDb();
  const [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return row ?? null;
}

export async function getCompanyByDriveFolderId(
  driveFolderId: string,
): Promise<CompanyRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companies)
    .where(eq(companies.driveFolderId, driveFolderId))
    .limit(1);
  return row ?? null;
}
