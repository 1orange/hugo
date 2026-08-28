import { CANONICAL_FOLDER_NAMES } from "@/modules/folder-taxonomy";
import { settings } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import { eq } from "drizzle-orm";

const SETTINGS_ID = 1;

export type SettingsRow = {
  driveParentFolderId: string | null;
  canonicalFolderNames: string[];
  lastSweepAt: string | null;
};

export function getSettings(): SettingsRow {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID))
    .get();

  if (!row) {
    db.insert(settings)
      .values({
        id: SETTINGS_ID,
        canonicalFolderNamesJson: JSON.stringify(CANONICAL_FOLDER_NAMES),
      })
      .run();
    return {
      driveParentFolderId: null,
      canonicalFolderNames: [...CANONICAL_FOLDER_NAMES],
      lastSweepAt: null,
    };
  }

  return {
    driveParentFolderId: row.driveParentFolderId,
    canonicalFolderNames: JSON.parse(row.canonicalFolderNamesJson) as string[],
    lastSweepAt: row.lastSweepAt,
  };
}

export function updateLastSweepAt(timestamp: string): void {
  const db = getDb();
  getSettings();
  db.update(settings)
    .set({ lastSweepAt: timestamp })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
}

export function setDriveParentFolderId(driveParentFolderId: string): void {
  const db = getDb();
  getSettings();
  db.update(settings)
    .set({ driveParentFolderId })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
}
