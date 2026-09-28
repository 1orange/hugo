import { CANONICAL_FOLDER_NAMES } from "@/modules/folder-taxonomy";
import {
  DEFAULT_MOVABLE_FOLDER_NAMES,
  normalizeFolderName,
  validateCanonicalFolderNames,
  validateMovableFolderNames,
} from "@/modules/folder-settings";
import { settings } from "@/lib/db/schema";
import { getDb } from "@/lib/db/migrate";
import { eq } from "drizzle-orm";

const SETTINGS_ID = 1;

export type SettingsRow = {
  driveParentFolderId: string | null;
  canonicalFolderNames: string[];
  movableFolderNames: string[];
  lastSweepAt: string | null;
  autoAdvanceAfterDecision: boolean;
  omegaT01EvidenceCode: string;
  omegaT01SeriesCode: string;
  omegaT01ReceivedEvidenceCode: string;
  omegaT01ReceivedSeriesCode: string;
  omegaT00EvidenceCode: string;
  omegaT00SeriesCode: string;
  omegaT00DocumentTypeCode: string;
  omegaT00ForeignDocumentTypeCode: string;
};

function defaultMovableFolderNames(): string[] {
  return [...DEFAULT_MOVABLE_FOLDER_NAMES];
}

function parseMovableFolderNames(raw: string | null | undefined): string[] {
  if (!raw) {
    return defaultMovableFolderNames();
  }
  return JSON.parse(raw) as string[];
}

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
        movableFolderNamesJson: JSON.stringify(defaultMovableFolderNames()),
      })
      .run();
    return {
      driveParentFolderId: null,
      canonicalFolderNames: [...CANONICAL_FOLDER_NAMES],
      movableFolderNames: defaultMovableFolderNames(),
      lastSweepAt: null,
      autoAdvanceAfterDecision: false,
      omegaT01EvidenceCode: "OF",
      omegaT01SeriesCode: "OF",
      omegaT01ReceivedEvidenceCode: "DF",
      omegaT01ReceivedSeriesCode: "DF",
      omegaT00EvidenceCode: "IDk",
      omegaT00SeriesCode: "IDk",
      omegaT00DocumentTypeCode: "180",
      omegaT00ForeignDocumentTypeCode: "380",
    };
  }

  return {
    driveParentFolderId: row.driveParentFolderId,
    canonicalFolderNames: JSON.parse(row.canonicalFolderNamesJson) as string[],
    movableFolderNames: parseMovableFolderNames(row.movableFolderNamesJson),
    lastSweepAt: row.lastSweepAt,
    autoAdvanceAfterDecision: row.autoAdvanceAfterDecision,
    omegaT01EvidenceCode: row.omegaT01EvidenceCode ?? "OF",
    omegaT01SeriesCode: row.omegaT01SeriesCode ?? "OF",
    omegaT01ReceivedEvidenceCode: row.omegaT01ReceivedEvidenceCode ?? "DF",
    omegaT01ReceivedSeriesCode: row.omegaT01ReceivedSeriesCode ?? "DF",
    omegaT00EvidenceCode: row.omegaT00EvidenceCode ?? "IDk",
    omegaT00SeriesCode: row.omegaT00SeriesCode ?? "IDk",
    omegaT00DocumentTypeCode: row.omegaT00DocumentTypeCode ?? "180",
    omegaT00ForeignDocumentTypeCode: row.omegaT00ForeignDocumentTypeCode ?? "380",
  };
}

export function setOmegaExportDefaults(input: {
  t01EvidenceCode: string;
  t01SeriesCode: string;
  t01ReceivedEvidenceCode: string;
  t01ReceivedSeriesCode: string;
  t00EvidenceCode: string;
  t00SeriesCode: string;
  t00DocumentTypeCode: string;
  t00ForeignDocumentTypeCode: string;
}): void {
  const db = getDb();
  getSettings();
  db.update(settings)
    .set({
      omegaT01EvidenceCode: input.t01EvidenceCode.trim() || "OF",
      omegaT01SeriesCode: input.t01SeriesCode.trim() || "OF",
      omegaT01ReceivedEvidenceCode: input.t01ReceivedEvidenceCode.trim() || "DF",
      omegaT01ReceivedSeriesCode: input.t01ReceivedSeriesCode.trim() || "DF",
      omegaT00EvidenceCode: input.t00EvidenceCode.trim() || "IDk",
      omegaT00SeriesCode: input.t00SeriesCode.trim() || "IDk",
      omegaT00DocumentTypeCode: input.t00DocumentTypeCode.trim() || "180",
      omegaT00ForeignDocumentTypeCode:
        input.t00ForeignDocumentTypeCode.trim() || "380",
    })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
}

export function setAutoAdvanceAfterDecision(enabled: boolean): void {
  const db = getDb();
  getSettings();
  db.update(settings)
    .set({ autoAdvanceAfterDecision: enabled })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
}

export function resolveDriveParentFolderId(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const stored = getSettings().driveParentFolderId;
  return stored ?? env.DRIVE_PARENT_FOLDER_ID ?? null;
}

export function requireDriveParentFolderId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const parentFolderId = resolveDriveParentFolderId(env);
  if (!parentFolderId) {
    throw new Error("DRIVE_PARENT_FOLDER_ID is not configured");
  }
  return parentFolderId;
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
    .set({ driveParentFolderId: driveParentFolderId.trim() })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
}

export type SettingsUpdateResult =
  | { ok: true; settings: SettingsRow }
  | { ok: false; message: string; errors?: Array<{ index: number; message: string }> };

export function updateCanonicalFolderNames(
  names: readonly string[],
): SettingsUpdateResult {
  const validation = validateCanonicalFolderNames(names);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.errors[0]!.message,
      errors: validation.errors,
    };
  }

  const db = getDb();
  getSettings();
  db.update(settings)
    .set({
      canonicalFolderNamesJson: JSON.stringify(validation.normalized),
    })
    .where(eq(settings.id, SETTINGS_ID))
    .run();

  return { ok: true, settings: getSettings() };
}

export function updateMovableFolderNames(
  names: readonly string[],
): SettingsUpdateResult {
  const current = getSettings();
  const validation = validateMovableFolderNames(
    names,
    current.canonicalFolderNames,
  );
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.errors[0]!.message,
      errors: validation.errors,
    };
  }

  const db = getDb();
  db.update(settings)
    .set({
      movableFolderNamesJson: JSON.stringify(validation.normalized),
    })
    .where(eq(settings.id, SETTINGS_ID))
    .run();

  return { ok: true, settings: getSettings() };
}

export function normalizeSettingsFolderNames(names: readonly string[]): string[] {
  return names.map((name) => normalizeFolderName(name));
}

/** The Drive changes channel Google notifies the webhook for (ADR 0020). */
export type DriveWatchChannel = {
  id: string;
  resourceId: string;
  token: string;
  expiresAt: string;
};

export function getDriveWatchChannel(): DriveWatchChannel | null {
  getSettings();
  const row = getDb().select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (!row?.driveWatchChannelId || !row.driveWatchResourceId || !row.driveWatchToken || !row.driveWatchExpiresAt) {
    return null;
  }
  return {
    id: row.driveWatchChannelId,
    resourceId: row.driveWatchResourceId,
    token: row.driveWatchToken,
    expiresAt: row.driveWatchExpiresAt,
  };
}

export function saveDriveWatchChannel(channel: DriveWatchChannel | null): void {
  getSettings();
  getDb()
    .update(settings)
    .set({
      driveWatchChannelId: channel?.id ?? null,
      driveWatchResourceId: channel?.resourceId ?? null,
      driveWatchToken: channel?.token ?? null,
      driveWatchExpiresAt: channel?.expiresAt ?? null,
    })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
}
