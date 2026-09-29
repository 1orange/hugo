import { getCompanyById } from "@/adapters/store/companies";
import { appendGlobalUserEvent } from "@/adapters/store/events";
import { listAllMonthFolders } from "@/adapters/store/month-folders";
import {
  getSettings,
  setAutoAdvanceAfterDecision,
  setDriveParentFolderId,
  updateCanonicalFolderNames,
  updateMovableFolderNames,
  type SettingsRow,
  type SettingsUpdateResult,
} from "@/adapters/store/settings";
import type { GlobalEventType } from "@/modules/activity-log";
import {
  previewCanonicalListImpact,
  validateCanonicalFolderNames,
  validateMovableFolderNames,
  type CanonicalListImpact,
} from "@/modules/folder-settings";

export type SettingsFormData = {
  driveParentFolderId: string;
  canonicalFolderNames: string[];
  movableFolderNames: string[];
  autoAdvanceAfterDecision: boolean;
};

export async function buildExistingFolderRefs() {
  const folders = await listAllMonthFolders();
  const companyNames = new Map<number, string | null>();
  for (const companyId of new Set(folders.map((folder) => folder.companyId))) {
    companyNames.set(companyId, (await getCompanyById(companyId))?.name ?? null);
  }
  return folders
    .map((folder) => {
      const companyName = companyNames.get(folder.companyId);
      if (!companyName) {
        return null;
      }
      return {
        companyId: folder.companyId,
        companyName,
        monthKey: folder.monthKey,
        folderName: folder.name,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export async function previewCanonicalFolderNamesChange(
  proposedNames: readonly string[],
): Promise<{ ok: true; impact: CanonicalListImpact } | { ok: false; message: string }> {
  const validation = validateCanonicalFolderNames(proposedNames);
  if (!validation.ok) {
    return { ok: false, message: validation.errors[0]!.message };
  }

  const current = await getSettings();
  const impact = previewCanonicalListImpact({
    currentCanonicalNames: current.canonicalFolderNames,
    proposedCanonicalNames: validation.normalized,
    existingFolders: await buildExistingFolderRefs(),
  });

  return { ok: true, impact };
}

async function recordSettingsEvent(
  type: GlobalEventType,
  previous: unknown,
  next: unknown,
): Promise<void> {
  await appendGlobalUserEvent(new Date().toISOString(), type, {
    previous,
    next,
  });
}

export async function saveGlobalSettings(input: SettingsFormData): Promise<SettingsUpdateResult> {
  const previous = await getSettings();
  const trimmedParentId = input.driveParentFolderId.trim();

  if (!trimmedParentId) {
    return { ok: false, message: "Drive parent folder id cannot be blank." };
  }

  const canonicalValidation = validateCanonicalFolderNames(
    input.canonicalFolderNames,
  );
  if (!canonicalValidation.ok) {
    return {
      ok: false,
      message: canonicalValidation.errors[0]!.message,
      errors: canonicalValidation.errors,
    };
  }

  const movableValidation = validateMovableFolderNames(
    input.movableFolderNames,
    canonicalValidation.normalized,
  );
  if (!movableValidation.ok) {
    return {
      ok: false,
      message: movableValidation.errors[0]!.message,
      errors: movableValidation.errors,
    };
  }

  const canonicalResult = await updateCanonicalFolderNames(
    canonicalValidation.normalized,
  );
  if (!canonicalResult.ok) {
    return canonicalResult;
  }

  const movableResult = await updateMovableFolderNames(movableValidation.normalized);
  if (!movableResult.ok) {
    return movableResult;
  }

  if (trimmedParentId !== (previous.driveParentFolderId ?? "")) {
    await setDriveParentFolderId(trimmedParentId);
    await recordSettingsEvent("DriveParentFolderIdChanged", {
      driveParentFolderId: previous.driveParentFolderId,
    }, {
      driveParentFolderId: trimmedParentId,
    });
  }

  const autoAdvance = input.autoAdvanceAfterDecision === true;
  if (autoAdvance !== previous.autoAdvanceAfterDecision) {
    await setAutoAdvanceAfterDecision(autoAdvance);
    await recordSettingsEvent(
      "AutoAdvanceChanged",
      previous.autoAdvanceAfterDecision,
      autoAdvance,
    );
  }

  const next = await getSettings();

  if (
    JSON.stringify(previous.canonicalFolderNames) !==
    JSON.stringify(next.canonicalFolderNames)
  ) {
    await recordSettingsEvent("CanonicalFolderNamesChanged", {
      canonicalFolderNames: previous.canonicalFolderNames,
    }, {
      canonicalFolderNames: next.canonicalFolderNames,
    });
  }

  if (
    JSON.stringify(previous.movableFolderNames) !==
    JSON.stringify(next.movableFolderNames)
  ) {
    await recordSettingsEvent("MovableFolderNamesChanged", {
      movableFolderNames: previous.movableFolderNames,
    }, {
      movableFolderNames: next.movableFolderNames,
    });
  }

  return { ok: true, settings: next };
}

export async function loadSettingsFormData(): Promise<SettingsRow & {
  effectiveDriveParentFolderId: string | null;
}> {
  const settings = await getSettings();
  return {
    ...settings,
    effectiveDriveParentFolderId:
      settings.driveParentFolderId ?? process.env.DRIVE_PARENT_FOLDER_ID ?? null,
  };
}
