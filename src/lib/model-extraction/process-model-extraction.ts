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
import { applyAdvanceSettlement } from "@/modules/advance-settlement";
import { runExtractionChecks } from "@/modules/extraction-checks";
import { deriveReceiptKind } from "@/modules/document-state";
import { printsEkasaMarks } from "@/modules/ekasa-text";
import { molSellerIco } from "@/modules/mol-invoice";
import { extractModelTextLines, modelTextForDocument, type ModelTextSource } from "./model-text";
import { readEmbeddedInvoiceXml } from "./embedded-invoice";
import { shouldExtractWithModel } from "./should-extract-with-model";

export type ModelExtractionSource = ModelTextSource;

/** What the model reads of one document, and where it goes once it is read. */
export type ModelTextInput = {
  companyId: number;
  monthKey: string;
  driveFileId: string;
  folderSlot: string;
  lines: string[];
  source?: ModelExtractionSource;
};

export type ModelDeps = {
  extractor: Extractor;
  now?: () => string;
  /**
   * The worker's reading lane passes this: the lines go to the model lane, and
   * the model reads them there. Without it the model reads them here, at once.
   */
  handOffToModel?: (input: ModelTextInput) => Promise<void>;
};

/**
 * Sends a document's lines to the model: to the model lane, or read here. Resolves
 * what the model read here (see processModelExtractionFromLines); handed over,
 * the model lane writes the result, so this resolves true.
 */
export async function sendToModel(input: ModelTextInput, deps: ModelDeps): Promise<boolean> {
  if (deps.handOffToModel) {
    await deps.handOffToModel(input);
    return true;
  }
  return processModelExtractionFromLines(input, { extractor: deps.extractor, now: deps.now });
}

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

/**
 * Reads one file and writes its document. Resolves true when a result was
 * written (complete or failed), false when nothing was written because the
 * service it needs was unreachable or the document is not to be read now.
 *
 * A `reread` of an undecided result from an older pipeline is read even though
 * its document is complete (PRD 0004); the caller decides what to keep.
 */
export async function processModelExtractionFile(
  input: {
    companyId: number;
    monthKey: string;
    driveFileId: string;
    folderSlot: string;
    mimeType: string;
    fileBytes: Uint8Array;
    reread?: boolean;
  },
  deps: ModelDeps & {
    pdfAccess: PdfAccess;
    ocr: Ocr;
  },
): Promise<boolean> {
  const now = deps.now?.() ?? new Date().toISOString();
  const editable = await assertMonthEditable(input.companyId, input.monthKey);
  if (editable) {
    return false;
  }

  if (!input.reread && (await extractionAlreadyAttempted(input.driveFileId))) {
    return false;
  }

  if (input.mimeType !== "application/pdf") {
    await writeExtractedPayload(
      input.driveFileId,
      {},
      "failed",
      "Automatic extraction supports PDF documents only.",
    );
    return true;
  }

  const e2eLines =
    process.env.E2E_TEST_AUTH === "true"
      ? stubTextLinesForDriveFile(input.driveFileId)
      : null;
  if (e2eLines === null && (await extractFromEmbeddedInvoiceXml(input, deps, now))) {
    return true;
  }
  const text = await modelTextForDocument({
    mimeType: input.mimeType,
    fileBytes: input.fileBytes,
    pdfAccess: deps.pdfAccess,
    ocr: deps.ocr,
    textLayerLines: e2eLines,
  });
  if (!text.ok) {
    return false;
  }
  const { lines, hadTextLayer, source: extractionSource } = text;

  if (!shouldExtractWithModel({ lines, hadTextLayer, fromOcr: extractionSource === "ocr" })) {
    await writeExtractedPayload(
      input.driveFileId,
      {},
      "failed",
      text.textLayerFailure ?? "The PDF has no extractable text layer.",
    );
    return true;
  }

  return sendToModel(
    {
      companyId: input.companyId,
      monthKey: input.monthKey,
      driveFileId: input.driveFileId,
      folderSlot: input.folderSlot,
      lines,
      source: extractionSource,
    },
    deps,
  );
}

/**
 * An invoice that carries its own data — an ISDOC, a MOL e-invoice — is read
 * from it: exact, no OCR, no model. The checks still run, against the XML
 * itself: data can be inconsistent, but not a hallucination. A MOL e-invoice
 * has no IČO; the seller's is taken from the PDF's text, beside the XML.
 */
export async function extractFromEmbeddedInvoiceXml(
  input: { companyId: number; monthKey: string; driveFileId: string; fileBytes: Uint8Array },
  deps: { pdfAccess: PdfAccess },
  now: string,
): Promise<boolean> {
  const embedded = await readEmbeddedInvoiceXml(input.fileBytes, deps.pdfAccess);
  if (!embedded) {
    return false;
  }
  const profile = await getCompanyProfile(input.companyId);
  let extracted = embedded.payload;
  const sourceTextLines = [embedded.xml];
  if (extracted.source === "mol") {
    const text = await extractModelTextLines(input.fileBytes, deps.pdfAccess);
    const lines = text.ok ? text.lines : [];
    sourceTextLines.push(...lines);
    const [seller, ...others] = extracted.parties;
    if (seller) {
      extracted = {
        ...extracted,
        parties: [{ ...seller, ico: molSellerIco(seller, lines, profile?.ico ?? null) }, ...others],
      };
    }
  }
  const source = extracted.source ?? "isdoc";
  const checked = runExtractionChecks({
    payload: extracted,
    sourceTextLines,
    monthKey: input.monthKey,
    // The data names its seller first: a Czech one's 21% is a Czech rate.
    issuerCountry: null,
  });
  const payload: ModelExtractedPayload = {
    ...checked.payload,
    source,
    fieldChecks: checked.flags,
  };
  await writeExtractedPayload(input.driveFileId, payload, "complete", null);
  await appendCompanySystemEvent(now, input.companyId, "Extracted", {
    monthKey: input.monthKey,
    driveFileId: input.driveFileId,
    source,
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
): Promise<boolean> {
  const profile = await getCompanyProfile(input.companyId);

  try {
    const result = await deps.extractor.extract({
      driveFileId: input.driveFileId,
      monthKey: input.monthKey,
      textLines: input.lines,
    });

    // An advance-settled invoice is booked at its supply, before the checks
    // and PRD 0003's derivations read the recap (ADR 0017 amendment).
    const checked = runExtractionChecks({
      payload: applyAdvanceSettlement(result.payload, input.lines),
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
    return true;
  } catch (error) {
    if (isExtractorUnreachableError(error)) {
      return false;
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
    return true;
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
): Promise<boolean> {
  const now = deps.now?.() ?? new Date().toISOString();
  return runModelExtractionOnLines(
    {
      ...input,
      source: input.source ?? "model",
    },
    deps,
    now,
  );
}
