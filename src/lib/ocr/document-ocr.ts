import type { Ocr } from "@/adapters/ocr/port";
import type { PdfAccess, PdfPageImage } from "@/adapters/pdf/port";
import { isReceiptImageMimeType } from "@/lib/cash-discovery/ekasa-qr-extraction";
import { groupOcrBoxesIntoLines, ocrReadingLines } from "@/modules/ocr-lines";

export function isOcrUnreachableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message;
  return (
    message.includes("fetch failed") ||
    message.includes("OCR HTTP") ||
    message.includes("OCR is unreachable") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("network")
  );
}

export async function pageImagesForDocument(input: {
  mimeType: string;
  fileBytes: Uint8Array;
  pdfAccess: PdfAccess;
}): Promise<PdfPageImage[]> {
  if (input.mimeType === "application/pdf") {
    return input.pdfAccess.extractPageImages(input.fileBytes);
  }
  if (isReceiptImageMimeType(input.mimeType)) {
    return [{ kind: "encoded", bytes: input.fileBytes }];
  }
  return [];
}

export async function ocrDocumentToLines(input: {
  mimeType: string;
  fileBytes: Uint8Array;
  pdfAccess: PdfAccess;
  ocr: Ocr;
}): Promise<
  /** `lines` are rows, for the eKasa parser; `readingLines` are for the model. */
  | { ok: true; lines: string[]; readingLines: string[]; durationMs: number }
  | { ok: false; unreachable: true }
  | { ok: false; unreachable: false; reason: string }
> {
  const images = await pageImagesForDocument(input);
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
