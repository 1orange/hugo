import { companyProfiles } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { eq, inArray } from "drizzle-orm";
import type { CompanyProfileFields } from "@/modules/company-profile";

export type CompanyProfileRow = CompanyProfileFields & { companyId: number };

export async function getCompanyProfile(companyId: number): Promise<CompanyProfileRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.companyId, companyId))
    .limit(1);
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

export async function listCompanyIdsWithoutProfile(companyIds: readonly number[]): Promise<Set<number>> {
  if (companyIds.length === 0) {
    return new Set();
  }
  const db = getDb();
  const withProfile = (
    await db
      .select({ companyId: companyProfiles.companyId })
      .from(companyProfiles)
      .where(inArray(companyProfiles.companyId, [...companyIds]))
  ).map((row) => row.companyId);
  const have = new Set(withProfile);
  return new Set(companyIds.filter((id) => !have.has(id)));
}

export async function saveCompanyProfile(
  companyId: number,
  profile: CompanyProfileFields,
): Promise<CompanyProfileRow> {
  const db = getDb();
  await db
    .insert(companyProfiles)
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
    });

  return { companyId, ...profile };
}
