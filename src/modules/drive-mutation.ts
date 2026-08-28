export type DriveCapabilities = {
  canRename: boolean;
  canMoveItemWithinDrive?: boolean;
};

export type MutationKind = "rename" | "move" | "create";

export type RenameMutationInput = {
  driveFileId: string;
  currentName: string;
  targetName: string;
  parentId: string;
  capabilities?: DriveCapabilities;
};

export type CapabilityCheckResult =
  | { allowed: true }
  | { allowed: false; message: string };

const DEFAULT_CAPABILITIES: DriveCapabilities = {
  canRename: true,
  canMoveItemWithinDrive: true,
};

export function resolveCapabilities(
  capabilities?: DriveCapabilities,
): DriveCapabilities {
  return capabilities ?? DEFAULT_CAPABILITIES;
}

export function checkRenameAllowed(input: {
  capabilities?: DriveCapabilities;
}): CapabilityCheckResult {
  const capabilities = resolveCapabilities(input.capabilities);
  if (!capabilities.canRename) {
    return {
      allowed: false,
      message:
        "Drive reports this folder cannot be renamed. It may be owned by the client or shared with restricted permissions.",
    };
  }
  return { allowed: true };
}

/**
 * A rename target arrives from the browser and is written into a client's Drive,
 * so it is checked against the canonical list rather than trusted. The UI only
 * ever offers canonical names; anything else means a stale form or a forged
 * request, and neither should reach Drive.
 */
export function checkRenameTarget(input: {
  currentName: string;
  targetName: string;
  canonicalFolderNames: readonly string[];
}): CapabilityCheckResult {
  if (!input.canonicalFolderNames.includes(input.targetName)) {
    return {
      allowed: false,
      message: `"${input.targetName}" is not one of the canonical folder names.`,
    };
  }

  if (input.currentName === input.targetName) {
    return { allowed: false, message: "Folder already has the target name." };
  }

  return { allowed: true };
}

export function buildRenameMutation(
  input: RenameMutationInput,
): RenameMutationInput {
  return { ...input };
}

export type CreateFolderMutationInput = {
  folderName: string;
  parentId: string;
  allowMonthFolder?: boolean;
};

/**
 * Folder names sent to Drive are validated here, not trusted from callers.
 * Month folders use YYYY_MM; subfolders must be on the canonical list.
 */
export function checkCreateFolderTarget(input: {
  folderName: string;
  canonicalFolderNames: readonly string[];
  allowMonthFolder?: boolean;
}): CapabilityCheckResult {
  if (input.allowMonthFolder && /^\d{4}_\d{2}$/.test(input.folderName)) {
    const month = Number(input.folderName.slice(5, 7));
    if (month >= 1 && month <= 12) {
      return { allowed: true };
    }
  }

  if (!input.canonicalFolderNames.includes(input.folderName)) {
    return {
      allowed: false,
      message: `"${input.folderName}" is not one of the canonical folder names.`,
    };
  }

  return { allowed: true };
}
