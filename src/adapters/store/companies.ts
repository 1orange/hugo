import { companies } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";

export type CompanyRow = {
  id: number;
  driveFolderId: string;
  name: string;
  active: boolean;
};

export function listCompanies(): CompanyRow[] {
  const db = getDb();
  return db.select().from(companies).all();
}
