const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export type PreviewKind = "pdf" | "image" | "unsupported";

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
  return "unsupported";
}

export function driveFileViewUrl(driveFileId: string): string {
  return `https://drive.google.com/file/d/${driveFileId}/view`;
}
