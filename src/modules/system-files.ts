/** Files an operating system or an editor writes by itself, named exactly so (compared lowercase). */
const SYSTEM_FILE_NAMES = new Set([
  // Windows folder settings and thumbnail caches.
  "desktop.ini",
  "thumbs.db",
  "ehthumbs.db",
  "ehthumbs_vista.db",
  // macOS Finder metadata.
  ".ds_store",
  ".localized",
  // KDE folder settings.
  ".directory",
]);

/**
 * A file nobody put in the folder as a document: Windows and macOS write
 * desktop.ini and .DS_Store into every folder a client opens, and Office
 * leaves a lock file beside the one it has open. Sixty of them sat in her
 * folders, five as documents waiting for a decision.
 *
 * Only what a machine writes by itself — a Word or Excel file can be an
 * invoice, so anything a person saved stays.
 */
export function isSystemFile(name: string): boolean {
  // macOS's custom-icon file is "Icon" and a carriage return.
  if (name === "Icon\r") {
    return true;
  }
  const lower = name.trim().toLowerCase();
  return (
    SYSTEM_FILE_NAMES.has(lower) ||
    // AppleDouble: a Mac's metadata for "x.pdf" copied to a foreign disk.
    lower.startsWith("._") ||
    // Office's owner file while "x.docx" is open; LibreOffice's lock.
    lower.startsWith("~$") ||
    lower.startsWith(".~lock.") ||
    // Windows shortcuts and editors' temporary files.
    lower.endsWith(".lnk") ||
    lower.endsWith(".tmp")
  );
}
