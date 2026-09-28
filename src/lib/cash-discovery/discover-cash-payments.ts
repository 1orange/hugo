import type { EkasaLookup } from "@/adapters/ekasa-lookup/port";
import type { Extractor } from "@/adapters/extractor/port";
import type { Ocr } from "@/adapters/ocr/port";
import type { DriveClient } from "@/adapters/drive/port";
import type { PdfAccess } from "@/adapters/pdf/port";
import type { QrReader } from "@/adapters/qr-reader/port";
import { appendCompanySystemEvent } from "@/adapters/store/events";
import {
  beginExtractionAttempt,
  ensureDocumentsForMonth,
  extractionAlreadyAttempted,
  getDocument,
  listDocumentsForFile,
  recordExtractionCrash,
  upsertEkasaExtractedPayload,
  writeExtractedPayload,
} from "@/adapters/store/documents";
import { listFilesForMonth } from "@/adapters/store/files";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import {
  emptyExtractedPayload,
  isEkasaPayload,
  parseExtractedPayload,
  withTypedEkasaUid,
} from "@/modules/document-payload";
import {
  extractEkasaForReceipt,
  extractEkasaFromTextLines,
  type OtherReceipt,
} from "./ekasa-extraction";
import { receiptDocumentId } from "@/modules/receipt-identity";
import { findEkasaUidInLines } from "@/modules/ekasa-identifiers";
import { ocrDocumentToLines } from "@/lib/ocr/document-ocr";
import { isReceiptImageMimeType } from "./ekasa-qr-extraction";
import { isProcessedFolderSlot } from "@/modules/document-state";
import { needsExtraction } from "@/modules/extraction-pipeline";
import { shouldExtractWithModel } from "@/lib/model-extraction/should-extract-with-model";
import {
  extractFromEmbeddedIsdoc,
  processModelExtractionFromLines,
} from "@/lib/model-extraction/process-model-extraction";
import { extractModelTextLines } from "@/lib/model-extraction/model-text";
import { stubTextLinesForDriveFile } from "@/adapters/extractor/stub-fixtures";

/**
 * Both receipt folders, not just the cash one. Every eBloček in the real corpus
 * sits in `05 Bločky_firemná karta`; `04 Bločky_hotovosť` holds none, so scoping
 * extraction to `04` — as this did while it was called "cash discovery" — matched
 * nothing at all on her actual data.
 *
 * Literal names rather than positions in the canonical list, which is editable in
 * settings and would otherwise silently repoint this.
 */
export const RECEIPT_FOLDER_SLOTS = [
  "04 Bločky_hotovosť",
  "05 Bločky_firemná karta",
] as const;

export type CashDiscoveryDeps = {
  driveClient: DriveClient;
  pdfAccess: PdfAccess;
  qrReader: QrReader;
  ekasaLookup: EkasaLookup;
  ocr: Ocr;
  extractor: Extractor;
  now?: () => string;
};

/**
 * The model reads the whole invoice, not only its first page — capped, because
 * a telecom itemisation can run to twenty pages the export never needs and CPU
 * time grows with every token. Every invoice in the corpus fits (O2: 3 pages).
 */

export async function extractReceiptTextLines(
  pdfBytes: Uint8Array,
  pdfAccess: PdfAccess,
  options: { maxPages?: number } = {},
): Promise<
  | { ok: true; lines: string[] }
  | { ok: false; reason: string }
> {
  try {
    const lines = await pdfAccess.extractTextLines(pdfBytes, options);
    if (lines.length === 0) {
      return {
        ok: false,
        reason: "The PDF has no extractable text layer.",
      };
    }
    return { ok: true, lines };
  } catch {
    return {
      ok: false,
      reason: "The PDF could not be opened for text extraction.",
    };
  }
}

function markManualEntry(
  input: {
    driveFileId: string;
    reason: string;
  },
): void {
  writeExtractedPayload(
    input.driveFileId,
    emptyExtractedPayload(),
    "failed",
    input.reason,
  );
}

async function wholeDocumentLines(
  pdfBytes: Uint8Array,
  pdfAccess: PdfAccess,
  firstPageLines: string[],
): Promise<string[]> {
  const extracted = await extractModelTextLines(pdfBytes, pdfAccess);
  return extracted.ok ? extracted.lines : firstPageLines;
}

function writeOtherReceipt(input: {
  companyId: number;
  monthKey: string;
  driveFileId: string;
  folderSlot: string;
  now: string;
  other: OtherReceipt;
}): void {
  const { other } = input;
  const base = {
    documentId: receiptDocumentId(input.driveFileId, other.uid),
    driveFileId: input.driveFileId,
    receiptUid: other.uid,
    companyId: input.companyId,
    monthKey: input.monthKey,
    folderSlot: input.folderSlot,
    createdAt: input.now,
  };
  if (!other.result.ok) {
    upsertEkasaExtractedPayload({
      ...base,
      payload: withTypedEkasaUid(emptyExtractedPayload(), other.uid),
      extractionStatus: "failed",
      extractionFailureReason: other.result.reason,
    });
    return;
  }
  const foreign = other.result.payload.currency !== "EUR";
  upsertEkasaExtractedPayload({
    ...base,
    payload: other.result.payload,
    extractionStatus: foreign ? "failed" : "complete",
    extractionFailureReason: foreign
      ? `Receipt is in ${other.result.payload.currency} — enter the EUR amount manually.`
      : null,
  });
  appendCompanySystemEvent(input.now, input.companyId, "Extracted", {
    monthKey: input.monthKey,
    driveFileId: input.driveFileId,
    documentId: base.documentId,
    source: other.result.source,
    status: foreign ? "failed" : "complete",
  });
}

export async function processCashReceiptFile(
  input: {
    companyId: number;
    monthKey: string;
    driveFileId: string;
    folderSlot: string;
    mimeType: string;
    fileBytes: Uint8Array;
  },
  deps: Pick<
    CashDiscoveryDeps,
    "pdfAccess" | "qrReader" | "ekasaLookup" | "ocr" | "extractor" | "now"
  >,
): Promise<void> {
  const now = deps.now?.() ?? new Date().toISOString();
  const editable = assertMonthEditable(input.companyId, input.monthKey);
  if (editable) {
    return;
  }

  ensureDocumentsForMonth(input.companyId, input.monthKey, now);

  if (extractionAlreadyAttempted(input.driveFileId)) {
    return;
  }

  const existingRow = getDocument(input.driveFileId);
  const existingPayload = parseExtractedPayload(
    existingRow?.extractedPayloadJson ?? "{}",
  );
  const cachedOpdResponse =
    isEkasaPayload(existingPayload) && existingPayload.opdResponse !== undefined
      ? existingPayload.opdResponse
      : undefined;
  // The file's further receipts, from an earlier read: their UIDs and responses.
  const cachedOpdResponsesByUid: Record<string, unknown> = {};
  for (const sibling of listDocumentsForFile(input.driveFileId)) {
    const siblingPayload = parseExtractedPayload(sibling.extractedPayloadJson);
    if (sibling.receiptUid && isEkasaPayload(siblingPayload) && siblingPayload.opdResponse !== undefined) {
      cachedOpdResponsesByUid[sibling.receiptUid] = siblingPayload.opdResponse;
    }
  }

  const e2eLines =
    process.env.E2E_TEST_AUTH === "true"
      ? stubTextLinesForDriveFile(input.driveFileId)
      : null;
  // An invoice filed with the receipts may carry its own ISDOC.
  if (
    e2eLines === null &&
    input.mimeType === "application/pdf" &&
    (await extractFromEmbeddedIsdoc(input, deps, now))
  ) {
    return;
  }
  const extracted =
    e2eLines !== null
      ? { ok: true as const, lines: e2eLines }
      : input.mimeType === "application/pdf"
        ? await extractReceiptTextLines(input.fileBytes, deps.pdfAccess)
        : { ok: true as const, lines: [] as string[] };

  let lines = extracted.ok ? extracted.lines : [];
  const hadTextLayer = extracted.ok && lines.length > 0;

  let ekasa = await extractEkasaForReceipt({
    lines,
    hadTextLayer,
    mimeType: input.mimeType,
    fileBytes: input.fileBytes,
    pdfAccess: deps.pdfAccess,
    qrReader: deps.qrReader,
    ekasaLookup: deps.ekasaLookup,
    cachedOpdResponse,
    preferredUid: isEkasaPayload(existingPayload) ? existingPayload.ekasaUid : null,
    cachedOpdResponsesByUid,
  });

  // Each further receipt in the file is a document of its own.
  for (const other of ekasa.otherReceipts ?? []) {
    writeOtherReceipt({ ...input, now, other });
  }

  let modelSource: "model" | "ocr" = "model";
  // The eKasa parser reads OCR rows; the model reads the page in reading order.
  let ocrReadingLines: string[] | null = null;

  if (
    !ekasa.ok &&
    !hadTextLayer &&
    !findEkasaUidInLines(lines) &&
    !ekasa.qrDecodedUid &&
    (ekasa.otherReceipts?.length ?? 0) === 0
  ) {
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
      ocrReadingLines = ocrResult.readingLines;
      modelSource = "ocr";
      ekasa = await extractEkasaFromTextLines({
        lines,
        ekasaLookup: deps.ekasaLookup,
        cachedOpdResponse,
      });
    }
  }

  if (!ekasa.ok) {
    if (shouldExtractWithModel({ lines, hadTextLayer, fromOcr: modelSource === "ocr" })) {
      // The eKasa parser only needed page 1; an invoice filed with the receipts
      // (the Bolt taxi invoice in 05) goes to the model whole.
      const modelLines =
        hadTextLayer && e2eLines === null
          ? await wholeDocumentLines(input.fileBytes, deps.pdfAccess, lines)
          : (ocrReadingLines ?? lines);
      await processModelExtractionFromLines(
        {
          companyId: input.companyId,
          monthKey: input.monthKey,
          driveFileId: input.driveFileId,
          folderSlot: input.folderSlot,
          lines: modelLines,
          source: modelSource,
        },
        { extractor: deps.extractor, now: deps.now },
      );
      return;
    }
    markManualEntry({
      driveFileId: input.driveFileId,
      reason: ekasa.reason,
    });
    return;
  }

  const payload = ekasa.payload;

  if (payload.currency !== "EUR") {
    upsertEkasaExtractedPayload({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      folderSlot: input.folderSlot,
      payload,
      extractionStatus: "failed",
      extractionFailureReason: `Receipt is in ${payload.currency} — enter the EUR amount manually.`,
      createdAt: now,
    });
    appendCompanySystemEvent(now, input.companyId, "Extracted", {
      monthKey: input.monthKey,
      driveFileId: input.driveFileId,
      source: ekasa.source,
      status: "failed",
    });
    return;
  }

  upsertEkasaExtractedPayload({
    driveFileId: input.driveFileId,
    companyId: input.companyId,
    monthKey: input.monthKey,
    folderSlot: input.folderSlot,
    payload,
    extractionStatus: "complete",
    extractionFailureReason: null,
    createdAt: now,
  });

  appendCompanySystemEvent(now, input.companyId, "Extracted", {
    monthKey: input.monthKey,
    driveFileId: input.driveFileId,
    source: ekasa.source,
    status: "complete",
  });
}

export function listCashReceiptCandidates(
  companyId: number,
  monthKey: string,
): Array<{
  driveFileId: string;
  name: string;
  mimeType: string;
  folderSlot: string;
}> {
  return listFilesForMonth(companyId, monthKey)
    .filter((file) => {
      if (file.deleted) {
        return false;
      }
      const folderSlot = file.folderSlot ?? "";
      // PDFs in the receipt folders; photos wherever a processed document may sit.
      if (file.mimeType === "application/pdf") {
        return (RECEIPT_FOLDER_SLOTS as readonly string[]).includes(folderSlot);
      }
      return isReceiptImageMimeType(file.mimeType) && isProcessedFolderSlot(folderSlot);
    })
    .map((file) => ({
      driveFileId: file.driveFileId,
      name: file.name,
      mimeType: file.mimeType,
      folderSlot: file.folderSlot!,
    }));
}

export async function discoverCashPaymentsForMonth(
  companyId: number,
  monthKey: string,
  deps: CashDiscoveryDeps,
): Promise<void> {
  const editable = assertMonthEditable(companyId, monthKey);
  if (editable) {
    return;
  }

  const now = deps.now?.() ?? new Date().toISOString();
  ensureDocumentsForMonth(companyId, monthKey, now);
  const candidates = listCashReceiptCandidates(companyId, monthKey);

  for (const file of candidates) {
    if (!needsExtraction(getDocument(file.driveFileId))) {
      continue;
    }

    beginExtractionAttempt(file.driveFileId);

    try {
      const fileBytes = await deps.driveClient.download(file.driveFileId);
      await processCashReceiptFile(
        {
          companyId,
          monthKey,
          driveFileId: file.driveFileId,
          folderSlot: file.folderSlot,
          mimeType: file.mimeType,
          fileBytes,
        },
        deps,
      );
    } catch (error) {
      recordExtractionCrash(file.driveFileId, error);
    }
  }
}

