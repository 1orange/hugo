import { CANONICAL_FOLDER_NAMES } from "@/modules/folder-taxonomy";
import {
  DEFAULT_MOVABLE_FOLDER_NAMES,
  normalizeFolderName,
  validateCanonicalFolderNames,
  validateMovableFolderNames,
} from "@/modules/folder-settings";
import { settings } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
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

/**
 * The one settings row, created on first read. Two replicas creating it at
 * once both succeed: the loser's insert does nothing.
 */
async function settingsRow(): Promise<typeof settings.$inferSelect> {
  const db = getDb();
  const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);
  if (row) {
    return row;
  }
  await db
    .insert(settings)
    .values({
      id: SETTINGS_ID,
      canonicalFolderNamesJson: JSON.stringify(CANONICAL_FOLDER_NAMES),
      movableFolderNamesJson: JSON.stringify(defaultMovableFolderNames()),
    })
    .onConflictDoNothing();
  const [created] = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);
  return created!;
}

export async function getSettings(): Promise<SettingsRow> {
  const row = await settingsRow();
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

/** Writes some settings, creating the row first if this is the first write. */
async function updateSettings(values: Partial<typeof settings.$inferInsert>): Promise<void> {
  await settingsRow();
  await getDb().update(settings).set(values).where(eq(settings.id, SETTINGS_ID));
}

export async function setOmegaExportDefaults(input: {
  t01EvidenceCode: string;
  t01SeriesCode: string;
  t01ReceivedEvidenceCode: string;
  t01ReceivedSeriesCode: string;
  t00EvidenceCode: string;
  t00SeriesCode: string;
  t00DocumentTypeCode: string;
  t00ForeignDocumentTypeCode: string;
}): Promise<void> {
  await updateSettings({
    omegaT01EvidenceCode: input.t01EvidenceCode.trim() || "OF",
    omegaT01SeriesCode: input.t01SeriesCode.trim() || "OF",
    omegaT01ReceivedEvidenceCode: input.t01ReceivedEvidenceCode.trim() || "DF",
    omegaT01ReceivedSeriesCode: input.t01ReceivedSeriesCode.trim() || "DF",
    omegaT00EvidenceCode: input.t00EvidenceCode.trim() || "IDk",
    omegaT00SeriesCode: input.t00SeriesCode.trim() || "IDk",
    omegaT00DocumentTypeCode: input.t00DocumentTypeCode.trim() || "180",
    omegaT00ForeignDocumentTypeCode:
      input.t00ForeignDocumentTypeCode.trim() || "380",
  });
}

export async function setAutoAdvanceAfterDecision(enabled: boolean): Promise<void> {
  await updateSettings({ autoAdvanceAfterDecision: enabled });
}

export async function resolveDriveParentFolderId(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const stored = (await getSettings()).driveParentFolderId;
  return stored ?? env.DRIVE_PARENT_FOLDER_ID ?? null;
}

export async function requireDriveParentFolderId(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const parentFolderId = await resolveDriveParentFolderId(env);
  if (!parentFolderId) {
    throw new Error("DRIVE_PARENT_FOLDER_ID is not configured");
  }
  return parentFolderId;
}

export async function updateLastSweepAt(timestamp: string): Promise<void> {
  await updateSettings({ lastSweepAt: timestamp });
}

export async function setDriveParentFolderId(driveParentFolderId: string): Promise<void> {
  await updateSettings({ driveParentFolderId: driveParentFolderId.trim() });
}

export type SettingsUpdateResult =
  | { ok: true; settings: SettingsRow }
  | { ok: false; message: string; errors?: Array<{ index: number; message: string }> };

export async function updateCanonicalFolderNames(
  names: readonly string[],
): Promise<SettingsUpdateResult> {
  const validation = validateCanonicalFolderNames(names);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.errors[0]!.message,
      errors: validation.errors,
    };
  }

  await updateSettings({
    canonicalFolderNamesJson: JSON.stringify(validation.normalized),
  });

  return { ok: true, settings: await getSettings() };
}

export async function updateMovableFolderNames(
  names: readonly string[],
): Promise<SettingsUpdateResult> {
  const current = await getSettings();
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

  await updateSettings({
    movableFolderNamesJson: JSON.stringify(validation.normalized),
  });

  return { ok: true, settings: await getSettings() };
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

export async function getDriveWatchChannel(): Promise<DriveWatchChannel | null> {
  const row = await settingsRow();
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

export async function saveDriveWatchChannel(channel: DriveWatchChannel | null): Promise<void> {
  await updateSettings({
    driveWatchChannelId: channel?.id ?? null,
    driveWatchResourceId: channel?.resourceId ?? null,
    driveWatchToken: channel?.token ?? null,
    driveWatchExpiresAt: channel?.expiresAt ?? null,
  });
}
