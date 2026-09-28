import type { Extractor } from "@/adapters/extractor/port";
import type { Ocr } from "@/adapters/ocr/port";
import type { PdfAccess } from "@/adapters/pdf/port";
import { getCompanyProfile } from "@/adapters/store/company-profiles";
import { appendCompanySystemEvent } from "@/adapters/store/events";
import {
  extractionAlreadyAttempted,
  writeExtractedPayload,
} from "@/adapters/store/documents";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import { stubTextLinesForDriveFile } from "@/adapters/extractor/stub-fixtures";
import {
  extractReceiptTextLines,
  MODEL_MAX_PDF_PAGES,
} from "@/lib/cash-discovery/discover-cash-payments";
import type { ModelExtractedPayload } from "@/modules/document-payload";
import { runExtractionChecks } from "@/modules/extraction-checks";
import { ocrDocumentToLines } from "@/lib/ocr/document-ocr";
import { shouldExtractWithModel } from "./should-extract-with-model";

export type ModelExtractionSource = "model" | "ocr";

export function isExtractorUnreachableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message;
  return (
    message.includes("fetch failed") ||
    message.includes("Extractor HTTP") ||
    message.includes("Extractor is unreachable") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("network")
  );
}

export async function processModelExtractionFile(
  input: {
    companyId: number;
    monthKey: string;
    driveFileId: string;
    folderSlot: string;
    mimeType: string;
    fileBytes: Uint8Array;
  },
  deps: {
    pdfAccess: PdfAccess;
    ocr: Ocr;
    extractor: Extractor;
    now?: () => string;
  },
): Promise<void> {
  const now = deps.now?.() ?? new Date().toISOString();
  const editable = assertMonthEditable(input.companyId, input.monthKey);
  if (editable) {
    return;
  }

  if (extractionAlreadyAttempted(input.driveFileId)) {
    return;
  }

  if (input.mimeType !== "application/pdf") {
    writeExtractedPayload(
      input.driveFileId,
      {},
      "failed",
      "Automatic extraction supports PDF documents only.",
    );
    return;
  }

  const e2eLines =
    process.env.E2E_TEST_AUTH === "true"
      ? stubTextLinesForDriveFile(input.driveFileId)
      : null;
  const extracted =
    e2eLines !== null
      ? { ok: true as const, lines: e2eLines }
      : await extractReceiptTextLines(input.fileBytes, deps.pdfAccess, {
          maxPages: MODEL_MAX_PDF_PAGES,
        });
  let lines = extracted.ok ? extracted.lines : [];
  let hadTextLayer = extracted.ok && lines.length > 0;
  let extractionSource: ModelExtractionSource = "model";

  if (!hadTextLayer) {
    const ocrResult = await ocrDocumentToLines({
      mimeType: input.mimeType,
      fileBytes: input.fileBytes,
      pdfAccess: deps.pdfAccess,
      ocr: deps.ocr,
    });
    if (ocrResult.ok === false && ocrResult.unreachable) {
      return;
    }
    if (ocrResult.ok) {
      lines = ocrResult.lines;
      extractionSource = "ocr";
    }
  }

  if (!shouldExtractWithModel({ lines, hadTextLayer, fromOcr: extractionSource === "ocr" })) {
    writeExtractedPayload(
      input.driveFileId,
      {},
      "failed",
      extracted.ok
        ? "The PDF has no extractable text layer."
        : extracted.reason,
    );
    return;
  }

  await runModelExtractionOnLines(
    {
      companyId: input.companyId,
      monthKey: input.monthKey,
      driveFileId: input.driveFileId,
      folderSlot: input.folderSlot,
      lines,
      source: extractionSource,
    },
    { extractor: deps.extractor, now: deps.now },
    now,
  );
}

async function runModelExtractionOnLines(
  input: {
    companyId: number;
    monthKey: string;
    driveFileId: string;
    folderSlot: string;
    lines: string[];
    source: ModelExtractionSource;
  },
  deps: {
    extractor: Extractor;
    now?: () => string;
  },
  now: string,
): Promise<void> {
  const profile = getCompanyProfile(input.companyId);

  try {
    const result = await deps.extractor.extract({
      driveFileId: input.driveFileId,
      monthKey: input.monthKey,
      textLines: input.lines,
    });

    const checked = runExtractionChecks({
      payload: result.payload,
      sourceTextLines: input.lines,
      monthKey: input.monthKey,
      issuerCountry: profile?.country ?? null,
    });

    const payload: ModelExtractedPayload = {
      ...checked.payload,
      source: input.source,
      fieldChecks: checked.flags,
    };

    writeExtractedPayload(input.driveFileId, payload, "complete", null);

    appendCompanySystemEvent(now, input.companyId, "Extracted", {
      monthKey: input.monthKey,
      driveFileId: input.driveFileId,
      source: input.source,
      status: "complete",
    });
  } catch (error) {
    if (isExtractorUnreachableError(error)) {
      return;
    }
    writeExtractedPayload(
      input.driveFileId,
      {},
      "failed",
      error instanceof Error ? error.message : "Model extraction failed.",
    );
    appendCompanySystemEvent(now, input.companyId, "Extracted", {
      monthKey: input.monthKey,
      driveFileId: input.driveFileId,
      source: input.source,
      status: "failed",
    });
  }
}

export async function processModelExtractionFromLines(
  input: {
    companyId: number;
    monthKey: string;
    driveFileId: string;
    folderSlot: string;
    lines: string[];
    source?: ModelExtractionSource;
  },
  deps: {
    extractor: Extractor;
    now?: () => string;
  },
): Promise<void> {
  const now = deps.now?.() ?? new Date().toISOString();
  await runModelExtractionOnLines(
    {
      ...input,
      source: input.source ?? "model",
    },
    deps,
    now,
  );
}
