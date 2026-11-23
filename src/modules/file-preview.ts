const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

/**
 * `text` is XML, shown as the text it is (bank statements arrive as XML). The
 * preview route serves it as `text/plain`, never as XML: a browser would render
 * the markup as a document, and a stylesheet in it could run.
 */
export type PreviewKind = "pdf" | "image" | "text" | "unsupported";

function normalizeMimeType(rawMimeType: string): string {
  return rawMimeType.split(";")[0]!.trim().toLowerCase();
}

export function isHeicMimeType(rawMimeType: string): boolean {
  return HEIC_MIME_TYPES.has(normalizeMimeType(rawMimeType));
}

export function previewKindForMimeType(rawMimeType: string): PreviewKind {
  const mimeType = normalizeMimeType(rawMimeType);

  if (mimeType === "application/pdf") {
    return "pdf";
  }
  if (
    mimeType === "image/jpeg" ||
    mimeType === "image/jpg" ||
    mimeType === "image/png" ||
    HEIC_MIME_TYPES.has(mimeType)
  ) {
    return "image";
  }
  if (mimeType === "application/xml" || mimeType === "text/xml") {
    return "text";
  }
  return "unsupported";
}

/**
 * The charset a text preview is served in: the one the XML declares, else UTF-8.
 * Bank exports are often windows-1250, and the browser decodes only what the
 * header names. `head` is the first bytes of the file, read as Latin-1 so that
 * any byte is a character.
 */
export function xmlPreviewCharset(head: string): string {
  // A UTF-8 byte-order mark may come first.
  const declared = /^(?:\xEF\xBB\xBF)?\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head);
  return declared ? declared[1]!.toLowerCase() : "utf-8";
}

export function driveFileViewUrl(driveFileId: string): string {
  return `https://drive.google.com/file/d/${driveFileId}/view`;
}
