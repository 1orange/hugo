import { events } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { saveCompanyProfile } from "@/adapters/store/company-profiles";
import { CLIENT_SHEET_REGISTER_SOURCE, type ProfileWrite } from "@/modules/client-sheet";

/**
 * Writes the confirmed profiles and their activity events in one transaction: a
 * profile never changes without the event that says so, and a failure leaves neither.
 * A profile is its Adresár subject (ADR 0022, amended 2026-11-16), so each write is a profile save.
 */
export async function writeClientSheetProfiles(
  writes: readonly ProfileWrite[],
  timestamp: string,
): Promise<void> {
  if (writes.length === 0) {
    return;
  }
  await getDb().transaction(async (tx) => {
    for (const write of writes) {
      await saveCompanyProfile(
        write.companyId,
        {
          country: write.values.country === "CZ" ? "CZ" : "SK",
          legalName: write.values.legalName,
          address: write.values.address,
          ico: write.values.ico,
          dic: write.values.dic,
          icDph: write.values.icDph,
          registerSource: CLIENT_SHEET_REGISTER_SOURCE,
          savedAt: timestamp,
        },
        [],
        tx,
      );

      await tx.insert(events).values({
        timestamp,
        companyId: write.companyId,
        actor: "user",
        type: "ImportedFromClientSheet",
        payloadJson: JSON.stringify({
          legalName: write.values.legalName,
          ico: write.values.ico,
          matchedBy: write.matchedBy,
          fields: write.written,
          overwritten: write.overwritten,
        }),
      });
    }
  });
}
