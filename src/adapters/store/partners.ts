import { eq } from "drizzle-orm";
import { partners } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { CompanyCountry } from "@/modules/company-profile";

export type PartnerRow = {
  id: number;
  companyId: number;
  country: CompanyCountry;
  ico: string;
  legalName: string;
  street: string;
  psc: string;
  city: string;
  dic: string;
  icDph: string;
  updatedAt: string;
};

export async function listPartnersForCompany(companyId: number): Promise<PartnerRow[]> {
  const db = getDb();
  return (await db.select().from(partners).where(eq(partners.companyId, companyId))) as PartnerRow[];
}

export async function upsertPartner(input: {
  companyId: number;
  country: CompanyCountry;
  ico: string;
  legalName: string;
  street: string;
  psc: string;
  city: string;
  dic: string;
  icDph: string;
  updatedAt: string;
}): Promise<void> {
  const db = getDb();
  const details = {
    legalName: input.legalName,
    street: input.street,
    psc: input.psc,
    city: input.city,
    dic: input.dic,
    icDph: input.icDph,
    updatedAt: input.updatedAt,
  };
  await db
    .insert(partners)
    .values({ companyId: input.companyId, country: input.country, ico: input.ico, ...details })
    .onConflictDoUpdate({
      target: [partners.companyId, partners.country, partners.ico],
      set: details,
    });
}
