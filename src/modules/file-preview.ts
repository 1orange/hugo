export const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export type PreviewKind = "pdf" | "image" | "heic-fallback" | "unsupported";

export function previewKindForMimeType(rawMimeType: string): PreviewKind {
  const mimeType = rawMimeType.trim().toLowerCase();

  if (mimeType === "application/pdf") {
    return "pdf";
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg" || mimeType === "image/png") {
    return "image";
  }
  if (HEIC_MIME_TYPES.has(mimeType)) {
  // ponytail: no in-browser HEIC decode without native libheif or a WASM port;
  // upgrade path is libheif on the VPS or heic2any-style WASM when bundle size is acceptable.
    return "heic-fallback";
  }
  return "unsupported";
}

export function driveFileViewUrl(driveFileId: string): string {
  return `https://drive.google.com/file/d/${driveFileId}/view`;
}
