import { companyProfiles, events } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { CLIENT_SHEET_REGISTER_SOURCE, type ProfileWrite } from "@/modules/client-sheet";

/**
 * Writes the confirmed profiles and their activity events in one transaction: a
 * profile never changes without the event that says so, and a failure leaves neither.
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
      const values = {
        country: write.values.country,
        legalName: write.values.legalName,
        address: write.values.address,
        ico: write.values.ico,
        dic: write.values.dic,
        icDph: write.values.icDph,
        registerSource: CLIENT_SHEET_REGISTER_SOURCE,
        savedAt: timestamp,
      };
      await tx
        .insert(companyProfiles)
        .values({ companyId: write.companyId, ...values })
        .onConflictDoUpdate({ target: companyProfiles.companyId, set: values });

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
