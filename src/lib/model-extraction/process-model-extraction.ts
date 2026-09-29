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
import type { ModelExtractedPayload } from "@/modules/document-payload";
import { runExtractionChecks } from "@/modules/extraction-checks";
import { deriveReceiptKind } from "@/modules/document-state";
import { printsEkasaMarks } from "@/modules/ekasa-text";
import { modelTextForDocument, type ModelTextSource } from "./model-text";
import { readEmbeddedIsdoc } from "./isdoc-document";
import { shouldExtractWithModel } from "./should-extract-with-model";

export type ModelExtractionSource = ModelTextSource;

export function isExtractorUnreachableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message;
  return (
    message.includes("fetch failed") ||
    // A server in trouble (5xx) is waited for; a request it refuses (4xx)
    // would be refused again, so that document fails with the reason.
    /Extractor HTTP 5\d\d/.test(message) ||
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
  const editable = await assertMonthEditable(input.companyId, input.monthKey);
  if (editable) {
    return;
  }

  if (await extractionAlreadyAttempted(input.driveFileId)) {
    return;
  }

  if (input.mimeType !== "application/pdf") {
    await writeExtractedPayload(
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
  if (e2eLines === null && (await extractFromEmbeddedIsdoc(input, deps, now))) {
    return;
  }
  const text = await modelTextForDocument({
    mimeType: input.mimeType,
    fileBytes: input.fileBytes,
    pdfAccess: deps.pdfAccess,
    ocr: deps.ocr,
    textLayerLines: e2eLines,
  });
  if (!text.ok) {
    return;
  }
  const { lines, hadTextLayer, source: extractionSource } = text;

  if (!shouldExtractWithModel({ lines, hadTextLayer, fromOcr: extractionSource === "ocr" })) {
    await writeExtractedPayload(
      input.driveFileId,
      {},
      "failed",
      text.textLayerFailure ?? "The PDF has no extractable text layer.",
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

/**
 * An invoice that carries its own ISDOC is read from it — exact, no OCR, no
 * model. The checks still run, against the XML itself: data can be
 * inconsistent, but not a hallucination.
 */
export async function extractFromEmbeddedIsdoc(
  input: { companyId: number; monthKey: string; driveFileId: string; fileBytes: Uint8Array },
  deps: { pdfAccess: PdfAccess },
  now: string,
): Promise<boolean> {
  const isdoc = await readEmbeddedIsdoc(input.fileBytes, deps.pdfAccess);
  if (!isdoc) {
    return false;
  }
  const profile = await getCompanyProfile(input.companyId);
  const checked = runExtractionChecks({
    payload: isdoc.payload,
    sourceTextLines: [isdoc.xml],
    monthKey: input.monthKey,
    issuerCountry: profile?.country ?? null,
  });
  const payload: ModelExtractedPayload = {
    ...checked.payload,
    source: "isdoc",
    fieldChecks: checked.flags,
  };
  await writeExtractedPayload(input.driveFileId, payload, "complete", null);
  await appendCompanySystemEvent(now, input.companyId, "Extracted", {
    monthKey: input.monthKey,
    driveFileId: input.driveFileId,
    source: "isdoc",
    status: "complete",
  });
  return true;
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
  const profile = await getCompanyProfile(input.companyId);

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
      client: profile,
      folderSlot: input.folderSlot,
    });

    const payload: ModelExtractedPayload = {
      ...checked.payload,
      source: input.source,
      fieldChecks: checked.flags,
      ...(deriveReceiptKind(input.folderSlot) !== null && !printsEkasaMarks(input.lines)
        ? { outsideEkasa: true as const }
        : {}),
    };

    await writeExtractedPayload(input.driveFileId, payload, "complete", null);

    await appendCompanySystemEvent(now, input.companyId, "Extracted", {
      monthKey: input.monthKey,
      driveFileId: input.driveFileId,
      source: input.source,
      status: "complete",
    });
  } catch (error) {
    if (isExtractorUnreachableError(error)) {
      return;
    }
    await writeExtractedPayload(
      input.driveFileId,
      {},
      "failed",
      error instanceof Error ? error.message : "Model extraction failed.",
    );
    await appendCompanySystemEvent(now, input.companyId, "Extracted", {
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
