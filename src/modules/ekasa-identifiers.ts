export const EKASA_UID_PATTERN = /^[OV]-[0-9A-Fa-f]{32}$/;
export const EKASA_OKP_PATTERN =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}$/;

/** Search match — UID may sit inside a longer QR payload (e.g. before `OKP:`). */
export const EKASA_UID_SEARCH_PATTERN = /[OV]-[0-9A-Fa-f]{32}/gi;

export function normalizeEkasaUid(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidEkasaUid(value: string): boolean {
  return EKASA_UID_PATTERN.test(normalizeEkasaUid(value));
}

export function validateEkasaUidInput(value: string):
  | { ok: true; uid: string }
  | { ok: false; message: string } {
  const uid = normalizeEkasaUid(value);
  if (!uid) {
    return {
      ok: false,
      message: "Zadaj UID eBločku (O- alebo V- a 32 hex znakov).",
    };
  }
  if (!isValidEkasaUid(uid)) {
    return {
      ok: false,
      message:
        "UID musí mať tvar O- alebo V- nasledované presne 32 hexadecimálnymi znakmi.",
    };
  }
  return { ok: true, uid };
}

export const EKASA_UID_NOT_FOUND_MESSAGE =
  "Doklad s týmto UID sa v eKase nenašiel.";

export function isValidEkasaOkp(value: string): boolean {
  return EKASA_OKP_PATTERN.test(value.trim());
}

function normalizeUidCandidate(candidate: string): string {
  return normalizeEkasaUid(candidate);
}

/**
 * First eKasa UID in text lines by content search, not whole-string match.
 * Handles the offline QR shape `V-…BBOKP: …`. Ignores near-misses (wrong length).
 */
export function findEkasaUidInText(text: string): string | null {
  EKASA_UID_SEARCH_PATTERN.lastIndex = 0;
  let match = EKASA_UID_SEARCH_PATTERN.exec(text);
  while (match) {
    const candidate = normalizeUidCandidate(match[0]!);
    if (isValidEkasaUid(candidate)) {
      return candidate;
    }
    match = EKASA_UID_SEARCH_PATTERN.exec(text);
  }
  return null;
}

export function findEkasaUidInLines(lines: readonly string[]): string | null {
  return findEkasaUidInText(lines.join("\n"));
}

export type EkasaUidFromQrResult =
  | { status: "found"; uid: string }
  | { status: "none" }
  | { status: "conflict"; reason: string };

export function pickEkasaUidFromQrPayloads(
  payloads: readonly string[],
): EkasaUidFromQrResult {
  const uids = new Set<string>();
  for (const payload of payloads) {
    const uid = findEkasaUidInText(payload);
    if (uid) {
      uids.add(uid);
    }
  }
  if (uids.size === 0) {
    return { status: "none" };
  }
  if (uids.size > 1) {
    return {
      status: "conflict",
      reason:
        "Multiple different eKasa UIDs found in QR codes — check the receipt.",
    };
  }
  return { status: "found", uid: [...uids][0]! };
}
