/**
 * Why a document could not be read, in her words. The stored reason stays the
 * pipeline's own text (logs and tests read it); screens show this instead.
 */
const CRASH_PREFIX = "Reading the document failed: ";

const KNOWN_DETAILS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /invalid pdf structure|pdf header|corrupt/iu, message: "Súbor PDF je poškodený, nedá sa otvoriť." },
  { pattern: /heic|heif/iu, message: "Fotografiu vo formáte HEIC sa nepodarilo otvoriť." },
  { pattern: /password|encrypted/iu, message: "Súbor je chránený heslom." },
  { pattern: /unsupported|mime/iu, message: "Tento typ súboru sa nedá prečítať." },
];

export function extractionFailureMessage(reason: string): string {
  if (reason === "no eKasa code found") {
    return "Na bločku sa nenašiel kód eKasa — zadaj UID alebo vyplň údaje ručne.";
  }
  if (reason.startsWith(CRASH_PREFIX)) {
    const detail = reason.slice(CRASH_PREFIX.length);
    const known = KNOWN_DETAILS.find((entry) => entry.pattern.test(detail));
    return known ? known.message : `Doklad sa nepodarilo prečítať (${detail}).`;
  }
  return reason;
}
