import { companyProfiles } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import { eq, inArray } from "drizzle-orm";
import type { CompanyProfileFields } from "@/modules/company-profile";

export type CompanyProfileRow = CompanyProfileFields & { companyId: number };

export function getCompanyProfile(companyId: number): CompanyProfileRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.companyId, companyId))
    .get();
  if (!row) {
    return null;
  }
  return {
    companyId: row.companyId,
    country: row.country as CompanyProfileFields["country"],
    legalName: row.legalName,
    address: row.address,
    ico: row.ico,
    dic: row.dic,
    icDph: row.icDph,
    registerSource: row.registerSource,
    savedAt: row.savedAt,
  };
}

export function listCompanyIdsWithoutProfile(companyIds: readonly number[]): Set<number> {
  if (companyIds.length === 0) {
    return new Set();
  }
  const db = getDb();
  const withProfile = db
    .select({ companyId: companyProfiles.companyId })
    .from(companyProfiles)
    .where(inArray(companyProfiles.companyId, [...companyIds]))
    .all()
    .map((row) => row.companyId);
  const have = new Set(withProfile);
  return new Set(companyIds.filter((id) => !have.has(id)));
}

export function saveCompanyProfile(
  companyId: number,
  profile: CompanyProfileFields,
): CompanyProfileRow {
  const db = getDb();
  db.insert(companyProfiles)
    .values({
      companyId,
      country: profile.country,
      legalName: profile.legalName,
      address: profile.address,
      ico: profile.ico,
      dic: profile.dic,
      icDph: profile.icDph,
      registerSource: profile.registerSource,
      savedAt: profile.savedAt,
    })
    .onConflictDoUpdate({
      target: companyProfiles.companyId,
      set: {
        country: profile.country,
        legalName: profile.legalName,
        address: profile.address,
        ico: profile.ico,
        dic: profile.dic,
        icDph: profile.icDph,
        registerSource: profile.registerSource,
        savedAt: profile.savedAt,
      },
    })
    .run();

  return { companyId, ...profile };
}
