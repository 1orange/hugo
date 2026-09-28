import type { Ocr } from "@/adapters/ocr/port";
import type { PdfAccess } from "@/adapters/pdf/port";
import { ocrDocumentToLines } from "@/lib/ocr/document-ocr";

/** Pages of a PDF the model reads. */
export const MODEL_MAX_PDF_PAGES = 5;

export type ModelTextSource = "model" | "ocr";

/**
 * A PDF's text layer as the model reads it: up to MODEL_MAX_PDF_PAGES pages,
 * a column at a time (reading-order module). The receipt parser keeps rows.
 */
export async function extractModelTextLines(
  pdfBytes: Uint8Array,
  pdfAccess: PdfAccess,
): Promise<{ ok: true; lines: string[] } | { ok: false; reason: string }> {
  try {
    const lines = await pdfAccess.extractTextLines(pdfBytes, {
      maxPages: MODEL_MAX_PDF_PAGES,
      order: "reading",
    });
    if (lines.length === 0) {
      return { ok: false, reason: "The PDF has no extractable text layer." };
    }
    return { ok: true, lines };
  } catch {
    return { ok: false, reason: "The PDF could not be opened for text extraction." };
  }
}

export type ModelTextForDocument =
  | {
      ok: true;
      lines: string[];
      source: ModelTextSource;
      hadTextLayer: boolean;
      /** Why the PDF's text layer gave nothing, when it was read. */
      textLayerFailure: string | null;
      ocrDurationMs: number | null;
    }
  /** The OCR service is down or unconfigured: the document waits. */
  | { ok: false; ocrUnreachable: true };

/**
 * What the model reads for a document: its text layer, else OCR of its page
 * images, both in reading order. The pipeline and the benchmark harness read
 * documents through this, so the benchmark scores the text the app sends.
 */
export async function modelTextForDocument(input: {
  mimeType: string;
  fileBytes: Uint8Array;
  pdfAccess: PdfAccess;
  ocr: Ocr;
  /** Lines to use as the text layer instead of reading it (the e2e stub). */
  textLayerLines?: string[] | null;
}): Promise<ModelTextForDocument> {
  let lines: string[] = [];
  let textLayerFailure: string | null = null;
  if (input.textLayerLines != null) {
    lines = input.textLayerLines;
  } else if (input.mimeType === "application/pdf") {
    const extracted = await extractModelTextLines(input.fileBytes, input.pdfAccess);
    if (extracted.ok) {
      lines = extracted.lines;
    } else {
      textLayerFailure = extracted.reason;
    }
  }
  if (lines.length > 0) {
    return { ok: true, lines, source: "model", hadTextLayer: true, textLayerFailure: null, ocrDurationMs: null };
  }

  const ocrResult = await ocrDocumentToLines(input);
  if (!ocrResult.ok && ocrResult.unreachable) {
    return { ok: false, ocrUnreachable: true };
  }
  if (ocrResult.ok) {
    return {
      ok: true,
      lines: ocrResult.readingLines,
      source: "ocr",
      hadTextLayer: false,
      textLayerFailure,
      ocrDurationMs: ocrResult.durationMs,
    };
  }
  return { ok: true, lines: [], source: "model", hadTextLayer: false, textLayerFailure, ocrDurationMs: null };
}
