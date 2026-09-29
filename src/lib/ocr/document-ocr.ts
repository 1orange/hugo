import type { Ocr } from "@/adapters/ocr/port";
import type { PdfAccess, PdfPageImage } from "@/adapters/pdf/port";
import { isReceiptImageMimeType } from "@/lib/cash-discovery/ekasa-qr-extraction";
import { groupOcrBoxesIntoLines, ocrReadingLines } from "@/modules/ocr-lines";
import { heicToJpeg } from "@/adapters/image/heic-to-jpeg";
import { OCR_MAX_SIDE_PX, prepareImageForOcr } from "@/adapters/image/ocr-image";
import { isHeicMimeType } from "@/modules/file-preview";

export function isOcrUnreachableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message;
  return (
    message.includes("fetch failed") ||
    // As for the model: a server in trouble is waited for, a refusal is not.
    /OCR HTTP 5\d\d/.test(message) ||
    message.includes("OCR is unreachable") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("network")
  );
}

/** Pages drawn for OCR: as many as the model reads (MODEL_MAX_PDF_PAGES). */
const RENDERED_MAX_PAGES = 5;
/** Twice what the OCR reads, so a small receipt cut to its print keeps its detail. */
const RENDERED_LONG_SIDE_PX = 2 * OCR_MAX_SIDE_PX;

/**
 * What OCR reads of a document. A PDF's page images, as the scanner stored
 * them — full resolution, which drawing the page would lose. The page drawn
 * instead when its text is drawn rather than scanned: a text layer that does
 * not read as text (`drawPages`), or a PDF with no image at all.
 */
export async function pageImagesForDocument(input: {
  mimeType: string;
  fileBytes: Uint8Array;
  pdfAccess: PdfAccess;
  drawPages?: boolean;
}): Promise<PdfPageImage[]> {
  if (input.mimeType === "application/pdf") {
    const draw = () =>
      input.pdfAccess.renderPages?.(input.fileBytes, {
        maxPages: RENDERED_MAX_PAGES,
        longSidePx: RENDERED_LONG_SIDE_PX,
      }) ?? Promise.resolve([]);
    if (input.drawPages) {
      const drawn = await draw().catch(() => []);
      if (drawn.length > 0) {
        return drawn;
      }
    }
    const images = await input.pdfAccess.extractPageImages(input.fileBytes);
    return images.length > 0 ? images : draw().catch(() => []);
  }
  if (isReceiptImageMimeType(input.mimeType)) {
    // The OCR sidecar has no HEIC decoder; an iPhone photo goes as JPEG.
    const bytes = isHeicMimeType(input.mimeType) ? await heicToJpeg(input.fileBytes) : input.fileBytes;
    return [{ kind: "encoded", bytes }];
  }
  return [];
}

export async function ocrDocumentToLines(input: {
  mimeType: string;
  fileBytes: Uint8Array;
  pdfAccess: PdfAccess;
  ocr: Ocr;
  /** Draw the pages rather than read their images (pageImagesForDocument). */
  drawPages?: boolean;
}): Promise<
  /** `lines` are rows, for the eKasa parser; `readingLines` are for the model. */
  | { ok: true; lines: string[]; readingLines: string[]; durationMs: number }
  | { ok: false; unreachable: true }
  | { ok: false; unreachable: false; reason: string }
> {
  const images = await Promise.all((await pageImagesForDocument(input)).map(prepareImageForOcr));
  if (images.length === 0) {
    return {
      ok: false,
      unreachable: false,
      reason: "Document has no page images for OCR.",
    };
  }

  try {
    const result = await input.ocr.recognize({ images });
    const lines = groupOcrBoxesIntoLines(result.boxes);
    if (lines.length === 0) {
      return {
        ok: false,
        unreachable: false,
        reason: "OCR returned no text.",
      };
    }
    return {
      ok: true,
      lines,
      readingLines: ocrReadingLines(result.boxes),
      durationMs: result.durationMs,
    };
  } catch (error) {
    if (isOcrUnreachableError(error)) {
      return { ok: false, unreachable: true };
    }
    return {
      ok: false,
      unreachable: false,
      reason: error instanceof Error ? error.message : "OCR failed.",
    };
  }
}
