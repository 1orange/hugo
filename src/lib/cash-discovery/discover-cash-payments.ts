import { CANONICAL_FOLDER_NAMES } from "@/modules/folder-taxonomy";
import {
  ekasaReceiptHasAmount,
  parseEkasaQr,
} from "@/modules/ekasa-qr";
import type { DriveClient } from "@/adapters/drive/port";
import type { PdfAccess, QrDecoder } from "@/adapters/pdf/port";
import {
  getDecodeJob,
  getManualQueueEntry,
  getPaymentByBlocekFileId,
  setDecodeJobStatus,
  upsertCashPayment,
  upsertManualQueueEntry,
} from "@/adapters/store/payments";
import { listFilesForMonth } from "@/adapters/store/files";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";

export const CASH_RECEIPTS_FOLDER = CANONICAL_FOLDER_NAMES[3];

export type CashDiscoveryDeps = {
  driveClient: DriveClient;
  pdfAccess: PdfAccess;
  qrDecoder: QrDecoder;
  now?: () => string;
};

async function decodeQrPayloadFromPdf(
  pdfBytes: Uint8Array,
  pdfAccess: PdfAccess,
  qrDecoder: QrDecoder,
): Promise<string | null> {
  const embeddedImages = await pdfAccess.extractEmbeddedImages(pdfBytes);
  for (const image of embeddedImages) {
    const payload = await qrDecoder.decodeFromImage(image);
    if (payload) {
      return payload;
    }
  }

  const rendered = await pdfAccess.renderPage(pdfBytes, { pageNumber: 1, scale: 3 });
  return qrDecoder.decodeFromImage(rendered);
}

export async function decodeReceiptPdf(
  pdfBytes: Uint8Array,
  deps: Pick<CashDiscoveryDeps, "pdfAccess" | "qrDecoder">,
): Promise<
  | { ok: true; payload: string }
  | { ok: false; reason: string }
> {
  try {
    const payload = await decodeQrPayloadFromPdf(
      pdfBytes,
      deps.pdfAccess,
      deps.qrDecoder,
    );
    if (!payload) {
      return {
        ok: false,
        reason: "No readable eKasa QR code was found in the PDF.",
      };
    }

    return { ok: true, payload: payload.trim() };
  } catch {
    return {
      ok: false,
      reason: "The PDF could not be opened for QR extraction.",
    };
  }
}

export async function processCashReceiptFile(
  input: {
    companyId: number;
    monthKey: string;
    driveFileId: string;
    pdfBytes: Uint8Array;
  },
  deps: Pick<CashDiscoveryDeps, "pdfAccess" | "qrDecoder" | "now">,
): Promise<void> {
  const now = deps.now?.() ?? new Date().toISOString();
  const editable = assertMonthEditable(input.companyId, input.monthKey);
  if (editable) {
    return;
  }

  if (getPaymentByBlocekFileId(input.driveFileId)) {
    setDecodeJobStatus(
      input.driveFileId,
      input.companyId,
      input.monthKey,
      "done",
      null,
      now,
    );
    return;
  }

  if (getManualQueueEntry(input.driveFileId)) {
    setDecodeJobStatus(
      input.driveFileId,
      input.companyId,
      input.monthKey,
      "done",
      null,
      now,
    );
    return;
  }

  const decoded = await decodeReceiptPdf(input.pdfBytes, deps);
  if (!decoded.ok) {
    upsertManualQueueEntry({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      reason: decoded.reason,
      createdAt: now,
    });
    setDecodeJobStatus(
      input.driveFileId,
      input.companyId,
      input.monthKey,
      "failed",
      decoded.reason,
      now,
    );
    return;
  }

  const parsed = parseEkasaQr(decoded.payload);
  if ("ok" in parsed) {
    upsertManualQueueEntry({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      reason: parsed.reason,
      createdAt: now,
    });
    setDecodeJobStatus(
      input.driveFileId,
      input.companyId,
      input.monthKey,
      "failed",
      parsed.reason,
      now,
    );
    return;
  }

  if (!ekasaReceiptHasAmount(parsed)) {
    upsertCashPayment({
      companyId: input.companyId,
      monthKey: input.monthKey,
      blocekFileId: input.driveFileId,
      amountCents: null,
      amountLiteral: null,
      receiptAt: null,
      receiptTimestampRaw: null,
      ekasaUid: parsed.uid,
      ekasaPayload: parsed.payload,
      decodeStatus: "manual",
      createdAt: now,
    });
    upsertManualQueueEntry({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      reason:
        "UID-only QR encodes the receipt identifier but not amount or timestamp — enter them manually.",
      createdAt: now,
    });
    setDecodeJobStatus(
      input.driveFileId,
      input.companyId,
      input.monthKey,
      "done",
      null,
      now,
    );
    return;
  }

  upsertCashPayment({
    companyId: input.companyId,
    monthKey: input.monthKey,
    blocekFileId: input.driveFileId,
    amountCents: parsed.amountCents,
    amountLiteral: parsed.amountLiteral,
    receiptAt: parsed.receiptAtUtc,
    receiptTimestampRaw: parsed.timestamp.raw,
    ekasaUid: null,
    ekasaPayload: parsed.payload,
    decodeStatus: "complete",
    createdAt: now,
  });
  setDecodeJobStatus(
    input.driveFileId,
    input.companyId,
    input.monthKey,
    "done",
    null,
    now,
  );
}

export function listCashReceiptCandidates(
  companyId: number,
  monthKey: string,
): Array<{
  driveFileId: string;
  name: string;
  mimeType: string;
}> {
  return listFilesForMonth(companyId, monthKey)
    .filter(
      (file) =>
        !file.deleted &&
        file.folderSlot === CASH_RECEIPTS_FOLDER &&
        file.mimeType === "application/pdf",
    )
    .map((file) => ({
      driveFileId: file.driveFileId,
      name: file.name,
      mimeType: file.mimeType,
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
  const candidates = listCashReceiptCandidates(companyId, monthKey);

  for (const file of candidates) {
    if (getPaymentByBlocekFileId(file.driveFileId)) {
      continue;
    }
    if (getManualQueueEntry(file.driveFileId)) {
      continue;
    }

    const existingJob = getDecodeJob(file.driveFileId);
    if (existingJob?.status === "pending") {
      continue;
    }

    setDecodeJobStatus(
      file.driveFileId,
      companyId,
      monthKey,
      "pending",
      null,
      now,
    );

    const pdfBytes = await deps.driveClient.download(file.driveFileId);
    await processCashReceiptFile(
      {
        companyId,
        monthKey,
        driveFileId: file.driveFileId,
        pdfBytes,
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
    // ponytail: month view stays fast; failures surface via pending/manual queue
  });
}
