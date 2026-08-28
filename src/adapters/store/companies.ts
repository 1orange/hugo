import { companies } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import { eq } from "drizzle-orm";

export type CompanyRow = {
  id: number;
  driveFolderId: string;
  name: string;
  active: boolean;
};

export function listCompanies(): CompanyRow[] {
  const db = getDb();
  return db
    .select()
    .from(companies)
    .where(eq(companies.active, true))
    .all();
}

export function upsertCompany(
  driveFolderId: string,
  name: string,
): CompanyRow {
  const db = getDb();
  const existing = db
    .select()
    .from(companies)
    .where(eq(companies.driveFolderId, driveFolderId))
    .get();

  if (existing) {
    if (existing.name !== name) {
      db.update(companies)
        .set({ name })
        .where(eq(companies.id, existing.id))
        .run();
    }
    return { ...existing, name };
  }

  const inserted = db
    .insert(companies)
    .values({ driveFolderId, name, active: true })
    .returning()
    .get();

  return inserted;
}

export function getCompanyById(id: number): CompanyRow | null {
  const db = getDb();
  return db.select().from(companies).where(eq(companies.id, id)).get() ?? null;
}

export function getCompanyByDriveFolderId(
  driveFolderId: string,
): CompanyRow | null {
  const db = getDb();
  return (
    db
      .select()
      .from(companies)
      .where(eq(companies.driveFolderId, driveFolderId))
      .get() ?? null
  );
}
