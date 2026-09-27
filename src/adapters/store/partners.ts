import { and, eq } from "drizzle-orm";
import { partners } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
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

export function listPartnersForCompany(companyId: number): PartnerRow[] {
  const db = getDb();
  return db
    .select()
    .from(partners)
    .where(eq(partners.companyId, companyId))
    .all() as PartnerRow[];
}

export function upsertPartner(input: {
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
}): void {
  const db = getDb();
  const existing = db
    .select({ id: partners.id })
    .from(partners)
    .where(
      and(
        eq(partners.companyId, input.companyId),
        eq(partners.country, input.country),
        eq(partners.ico, input.ico),
      ),
    )
    .get();

  if (existing) {
    db.update(partners)
      .set({
        legalName: input.legalName,
        street: input.street,
        psc: input.psc,
        city: input.city,
        dic: input.dic,
        icDph: input.icDph,
        updatedAt: input.updatedAt,
      })
      .where(eq(partners.id, existing.id))
      .run();
    return;
  }

  db.insert(partners)
    .values({
      companyId: input.companyId,
      country: input.country,
      ico: input.ico,
      legalName: input.legalName,
      street: input.street,
      psc: input.psc,
      city: input.city,
      dic: input.dic,
      icDph: input.icDph,
      updatedAt: input.updatedAt,
    })
    .run();
}
