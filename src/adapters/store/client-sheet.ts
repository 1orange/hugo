import { and, eq } from "drizzle-orm";
import { events, subjects } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { saveCompanyProfile, type ProfileWriter } from "@/adapters/store/company-profiles";
import { toColumns, toSubject, type SubjectPatch, type SubjectRow } from "@/adapters/store/subjects";
import {
  CLIENT_SHEET_REGISTER_SOURCE,
  type AdresarWrite,
  type OfficeField,
  type ProfileWrite,
} from "@/modules/client-sheet";

/** The identity fields a subject holds as columns; the country and IČO are its key. */
const IDENTITY_KEYS = ["legalName", "address", "dic", "icDph"] as const;
type IdentityKey = (typeof IDENTITY_KEYS)[number];

function isIdentityKey(field: string): field is IdentityKey {
  return (IDENTITY_KEYS as readonly string[]).includes(field);
}

function vatIdOf(icDph: string | null): string | null {
  return icDph ? icDph.replace(/\s+/g, "").toUpperCase() : null;
}

/** The sheet's *Vedie* and *Spolupráca* columns, for the office fields this write changes. */
function officeColumnsOf(write: { office: readonly OfficeField[]; keeper: string | null; cooperation: string | null }) {
  const columns: { officeKeeper?: string; officeCooperation?: string } = {};
  if (write.office.includes("keeper") && write.keeper !== null) {
    columns.officeKeeper = write.keeper;
  }
  if (write.office.includes("cooperation") && write.cooperation !== null) {
    columns.officeCooperation = write.cooperation;
  }
  return columns;
}

/**
 * Writes the confirmed company profiles, the Adresár subjects of the office clients, and their
 * activity events, in one transaction: nothing changes without the event that says so, and a
 * failure leaves neither. A company's profile is its subject (ADR 0022, amended 2026-11-16), so
 * a profile write is a profile save; its office data (*Vedie*, *Spolupráca*) is set on the same subject.
 *
 * The save's registerSource marks the values it changes as the sheet's (source `sheet`), so a
 * ticked field that was hand-saved stops being manual, and a field she did not tick keeps its source.
 * Returns the ids of the Adresár subjects written, so the caller can queue their register check.
 */
export async function writeClientSheet(
  profiles: readonly ProfileWrite[],
  adresar: readonly AdresarWrite[],
  timestamp: string,
): Promise<{ subjectIds: number[] }> {
  const subjectIds: number[] = [];
  if (profiles.length === 0 && adresar.length === 0) {
    return { subjectIds };
  }
  await getDb().transaction(async (tx) => {
    for (const write of profiles) {
      // A company with no linked subject yet is linked by its profile save, even when no value is written.
      const [linkedNow] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.linkedCompanyId, write.companyId))
        .limit(1);
      if (write.written.length > 0 || !linkedNow) {
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
      }

      const office = officeColumnsOf(write);
      if (Object.keys(office).length > 0) {
        await tx.update(subjects).set(office).where(eq(subjects.linkedCompanyId, write.companyId));
      }

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
          office: write.office,
        }),
      });
    }

    for (const write of adresar) {
      const subjectId = await writeOfficeClient(tx, write, timestamp);
      subjectIds.push(subjectId);
      await tx.insert(events).values({
        timestamp,
        companyId: null,
        actor: "user",
        type: "SubjectImportedFromClientSheet",
        payloadJson: JSON.stringify({
          subjectId,
          legalName: write.values.legalName,
          ico: write.ico,
          isNew: write.isNew,
          fields: write.written,
          overwritten: write.overwritten,
          office: write.office,
        }),
      });
    }
  });
  return { subjectIds };
}

/**
 * Creates or updates the Adresár subject of an IČO no company holds, by (SK, IČO), as an office
 * client. Only the fields the write sets change; the sheet's values carry source `sheet`, and
 * a field she did not tick keeps what it has. A subject that already is a company's profile is
 * refused here: the plan keeps such a row out, so this is only the last check, and it rolls back.
 */
async function writeOfficeClient(
  tx: ProfileWriter,
  write: AdresarWrite,
  timestamp: string,
): Promise<number> {
  const [found] = await tx
    .select()
    .from(subjects)
    .where(and(eq(subjects.country, "SK"), eq(subjects.ico, write.ico)))
    .limit(1);
  if (found && found.linkedCompanyId !== null) {
    throw new Error("IČO už patrí profilu firmy.");
  }
  const previous: SubjectRow | null = found ? toSubject(found) : null;

  const identity: Partial<Record<IdentityKey, string | null>> = {};
  const sources: SubjectRow["sources"] = { ...(previous?.sources ?? {}) };
  const written = write.written.filter(isIdentityKey);
  for (const field of written) {
    identity[field] = write.values[field].trim() || null;
    sources[field] = "sheet";
  }
  const office = officeColumnsOf(write);

  if (previous) {
    const patch: SubjectPatch = {
      ...identity,
      sources,
      manualFields: previous.manualFields.filter((field) => !(written as string[]).includes(field)),
      findings: previous.findings.filter(
        (finding) => !(finding.kind === "register-disagrees" && (written as string[]).includes(finding.field)),
      ),
      ...(identity.icDph !== undefined ? { vatId: vatIdOf(identity.icDph ?? null) } : {}),
    };
    await tx
      .update(subjects)
      .set({ ...toColumns(patch), officeClient: true, ...office })
      .where(eq(subjects.id, previous.id));
    return previous.id;
  }

  const [created] = await tx
    .insert(subjects)
    .values({
      country: "SK",
      ico: write.ico,
      vatId: vatIdOf(identity.icDph ?? null),
      legalName: identity.legalName ?? null,
      address: identity.address ?? null,
      dic: identity.dic ?? null,
      icDph: identity.icDph ?? null,
      sourcesJson: JSON.stringify(sources),
      officeClient: true,
      officeKeeper: office.officeKeeper ?? null,
      officeCooperation: office.officeCooperation ?? null,
      lastSeenAt: timestamp,
      createdAt: timestamp,
    })
    .returning({ id: subjects.id });
  return created!.id;
}
