import { createHash } from "node:crypto";

/*
 * The 2026-08 defaults that the office replaced on 2026-11-11 (ADR 0007 and ADR 0006
 * amendments). A stored list is replaced only when it is still exactly that default.
 * The old names are identified by fingerprint rather than spelled out here, so they
 * do not stay in the source; they are in git history before this change.
 */
export const LEGACY_CANONICAL_FINGERPRINT =
  "24450f5899ab88e5f1a155e69941e50318b23fb75946c0c68a2a338ee3246fad";

export const LEGACY_MOVABLE_FINGERPRINT =
  "10d86e998b00205fb3d219460998a59cdfbbeecce23f082dbfc8815b5c0e4079";

/*
 * The 2026-11-11 defaults (seven names, cash and card receipts apart), replaced the
 * next day by the office's eight document types ("Štruktúra disku Doklady klientov").
 */
export const NOVEMBER_CANONICAL_FINGERPRINT =
  "4b644acc1220222dab94fdd55ea64975760682d620fa96dcf0d5d72cdb8e46be";

export const NOVEMBER_MOVABLE_FINGERPRINT =
  "b25b2d66a32521e0e0e98dac4918ee0e7becca1dfcb82898973b1b32208f7745";

/**
 * Identifies a folder list by its names in order, each in NFC, so that the same
 * list stored in either Unicode form has the same fingerprint.
 */
export function folderListFingerprint(names: readonly string[]): string {
  const joined = names.map((name) => name.normalize("NFC")).join("\n");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

/**
 * The JSON to store in place of `storedJson`, when it is exactly the legacy default
 * identified by `legacyFingerprint`; null when it is anything else, including a
 * customised list, a list already migrated, or no list at all.
 */
export function migratedFolderListJson(
  storedJson: string | null | undefined,
  legacyFingerprint: string | readonly string[],
  replacement: readonly string[],
): string | null {
  const legacy = typeof legacyFingerprint === "string" ? [legacyFingerprint] : legacyFingerprint;
  if (storedJson === null || storedJson === undefined) {
    return null;
  }

  let stored: unknown;
  try {
    stored = JSON.parse(storedJson);
  } catch {
    return null;
  }
  if (!Array.isArray(stored) || !stored.every((name) => typeof name === "string")) {
    return null;
  }

  return legacy.includes(folderListFingerprint(stored))
    ? JSON.stringify(replacement)
    : null;
}
