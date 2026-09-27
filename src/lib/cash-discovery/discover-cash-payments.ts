import type { EkasaLookup } from "@/adapters/ekasa-lookup/port";
import type { Extractor } from "@/adapters/extractor/port";
import type { Ocr } from "@/adapters/ocr/port";
import type { DriveClient } from "@/adapters/drive/port";
import type { PdfAccess } from "@/adapters/pdf/port";
import type { QrReader } from "@/adapters/qr-reader/port";
import { appendCompanySystemEvent } from "@/adapters/store/events";
import {
  ensureDocumentsForMonth,
  extractionAlreadyAttempted,
  getDocument,
  setExtractionStatus,
  upsertEkasaExtractedPayload,
  writeExtractedPayload,
} from "@/adapters/store/documents";
import { listFilesForMonth } from "@/adapters/store/files";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";
import {
  emptyExtractedPayload,
  isEkasaPayload,
  parseExtractedPayload,
} from "@/modules/document-payload";
import { extractEkasaForReceipt, extractEkasaFromTextLines } from "./ekasa-extraction";
import { findEkasaUidInLines } from "@/modules/ekasa-identifiers";
import { ocrDocumentToLines } from "@/lib/ocr/document-ocr";
import { isReceiptImageMimeType } from "./ekasa-qr-extraction";
import { shouldExtractWithModel } from "@/lib/model-extraction/should-extract-with-model";
import { processModelExtractionFromLines } from "@/lib/model-extraction/process-model-extraction";
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

export async function extractReceiptTextLines(
  pdfBytes: Uint8Array,
  pdfAccess: PdfAccess,
): Promise<
  | { ok: true; lines: string[] }
  | { ok: false; reason: string }
> {
  try {
    const lines = await pdfAccess.extractTextLines(pdfBytes);
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

  const e2eLines =
    process.env.E2E_TEST_AUTH === "true"
      ? stubTextLinesForDriveFile(input.driveFileId)
      : null;
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
  });

  let modelSource: "model" | "ocr" = "model";

  if (
    !ekasa.ok &&
    !hadTextLayer &&
    !findEkasaUidInLines(lines) &&
    !ekasa.qrDecodedUid
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
      await processModelExtractionFromLines(
        {
          companyId: input.companyId,
          monthKey: input.monthKey,
          driveFileId: input.driveFileId,
          folderSlot: input.folderSlot,
          lines,
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
    .filter(
      (file) =>
        !file.deleted &&
        (RECEIPT_FOLDER_SLOTS as readonly string[]).includes(
          file.folderSlot ?? "",
        ) &&
        file.mimeType === "application/pdf" ||
        isReceiptImageMimeType(file.mimeType),
    )
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
    const existing = getDocument(file.driveFileId);
    if (existing && existing.extractionStatus !== "pending") {
      continue;
    }

    setExtractionStatus(file.driveFileId, "pending", null);

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
  }
}

export function scheduleCashPaymentDiscovery(
  companyId: number,
  monthKey: string,
  deps: CashDiscoveryDeps,
): void {
  void discoverCashPaymentsForMonth(companyId, monthKey, deps).catch(() => {
    // ponytail: month view stays fast; failures surface via extraction state
  });
}
