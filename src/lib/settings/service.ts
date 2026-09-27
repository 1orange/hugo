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

export function buildExistingFolderRefs() {
  return listAllMonthFolders()
    .map((folder) => {
      const company = getCompanyById(folder.companyId);
      if (!company) {
        return null;
      }
      return {
        companyId: folder.companyId,
        companyName: company.name,
        monthKey: folder.monthKey,
        folderName: folder.name,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export function previewCanonicalFolderNamesChange(
  proposedNames: readonly string[],
): { ok: true; impact: CanonicalListImpact } | { ok: false; message: string } {
  const validation = validateCanonicalFolderNames(proposedNames);
  if (!validation.ok) {
    return { ok: false, message: validation.errors[0]!.message };
  }

  const current = getSettings();
  const impact = previewCanonicalListImpact({
    currentCanonicalNames: current.canonicalFolderNames,
    proposedCanonicalNames: validation.normalized,
    existingFolders: buildExistingFolderRefs(),
  });

  return { ok: true, impact };
}

function recordSettingsEvent(
  type: GlobalEventType,
  previous: unknown,
  next: unknown,
): void {
  appendGlobalUserEvent(new Date().toISOString(), type, {
    previous,
    next,
  });
}

export function saveGlobalSettings(input: SettingsFormData): SettingsUpdateResult {
  const previous = getSettings();
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

  const canonicalResult = updateCanonicalFolderNames(
    canonicalValidation.normalized,
  );
  if (!canonicalResult.ok) {
    return canonicalResult;
  }

  const movableResult = updateMovableFolderNames(movableValidation.normalized);
  if (!movableResult.ok) {
    return movableResult;
  }

  if (trimmedParentId !== (previous.driveParentFolderId ?? "")) {
    setDriveParentFolderId(trimmedParentId);
    recordSettingsEvent("DriveParentFolderIdChanged", {
      driveParentFolderId: previous.driveParentFolderId,
    }, {
      driveParentFolderId: trimmedParentId,
    });
  }

  const autoAdvance = input.autoAdvanceAfterDecision === true;
  if (autoAdvance !== previous.autoAdvanceAfterDecision) {
    setAutoAdvanceAfterDecision(autoAdvance);
    recordSettingsEvent(
      "AutoAdvanceChanged",
      previous.autoAdvanceAfterDecision,
      autoAdvance,
    );
  }

  const next = getSettings();

  if (
    JSON.stringify(previous.canonicalFolderNames) !==
    JSON.stringify(next.canonicalFolderNames)
  ) {
    recordSettingsEvent("CanonicalFolderNamesChanged", {
      canonicalFolderNames: previous.canonicalFolderNames,
    }, {
      canonicalFolderNames: next.canonicalFolderNames,
    });
  }

  if (
    JSON.stringify(previous.movableFolderNames) !==
    JSON.stringify(next.movableFolderNames)
  ) {
    recordSettingsEvent("MovableFolderNamesChanged", {
      movableFolderNames: previous.movableFolderNames,
    }, {
      movableFolderNames: next.movableFolderNames,
    });
  }

  return { ok: true, settings: next };
}

export function loadSettingsFormData(): SettingsRow & {
  effectiveDriveParentFolderId: string | null;
} {
  const settings = getSettings();
  return {
    ...settings,
    effectiveDriveParentFolderId:
      settings.driveParentFolderId ?? process.env.DRIVE_PARENT_FOLDER_ID ?? null,
  };
}
