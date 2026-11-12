import { CANONICAL_FOLDER_NAMES } from "../../modules/folder-taxonomy";
import { DEFAULT_MOVABLE_FOLDER_NAMES } from "../../modules/folder-settings";
import {
  LEGACY_CANONICAL_FINGERPRINT,
  LEGACY_MOVABLE_FINGERPRINT,
  NOVEMBER_CANONICAL_FINGERPRINT,
  NOVEMBER_MOVABLE_FINGERPRINT,
  migratedFolderListJson,
} from "../../modules/folder-defaults";

/** What this needs from a Postgres client: pg's Client, or PGlite in tests. */
export type SqlRunner = {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
};

type StoredLists = {
  canonical_folder_names_json: string;
  movable_folder_names_json: string | null;
};

/**
 * Moves the settings lists from an earlier default (2026-08, or the seven names of
 * 2026-11-11) to the office's eight document types (ADR 0007 amendments). A list changes only if it still equals the old default; a
 * customised list is left alone. Running it again changes nothing, because a migrated
 * list no longer matches. Each update is conditional on the value read, so a concurrent
 * change to the row is not overwritten.
 */
export async function migrateLegacyFolderDefaults(db: SqlRunner): Promise<void> {
  const { rows } = await db.query(
    `SELECT canonical_folder_names_json, movable_folder_names_json
       FROM settings WHERE id = 1`,
  );
  const row = rows[0] as StoredLists | undefined;
  if (!row) {
    return;
  }

  const canonical = migratedFolderListJson(
    row.canonical_folder_names_json,
    [LEGACY_CANONICAL_FINGERPRINT, NOVEMBER_CANONICAL_FINGERPRINT],
    CANONICAL_FOLDER_NAMES,
  );
  if (canonical !== null) {
    await db.query(
      `UPDATE settings SET canonical_folder_names_json = $1
        WHERE id = 1 AND canonical_folder_names_json = $2`,
      [canonical, row.canonical_folder_names_json],
    );
  }

  const movable = migratedFolderListJson(
    row.movable_folder_names_json,
    [LEGACY_MOVABLE_FINGERPRINT, NOVEMBER_MOVABLE_FINGERPRINT],
    DEFAULT_MOVABLE_FOLDER_NAMES,
  );
  if (movable !== null) {
    await db.query(
      `UPDATE settings SET movable_folder_names_json = $1
        WHERE id = 1 AND movable_folder_names_json = $2`,
      [movable, row.movable_folder_names_json],
    );
  }
}
