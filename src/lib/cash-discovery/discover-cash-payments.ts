import { CANONICAL_FOLDER_NAMES } from "@/modules/folder-taxonomy";
import {
  isEkasaReceipt,
  parseEkasaText,
  validateEkasaArithmetic,
} from "@/modules/ekasa-text";
import type { DriveClient } from "@/adapters/drive/port";
import type { PdfAccess } from "@/adapters/pdf/port";
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

export async function processCashReceiptFile(
  input: {
    companyId: number;
    monthKey: string;
    driveFileId: string;
    pdfBytes: Uint8Array;
  },
  deps: Pick<CashDiscoveryDeps, "pdfAccess" | "now">,
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

  const extracted = await extractReceiptTextLines(input.pdfBytes, deps.pdfAccess);
  if (!extracted.ok) {
    upsertManualQueueEntry({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      reason: extracted.reason,
      createdAt: now,
    });
    setDecodeJobStatus(
      input.driveFileId,
      input.companyId,
      input.monthKey,
      "failed",
      extracted.reason,
      now,
    );
    return;
  }

  if (!isEkasaReceipt(extracted.lines)) {
    const reason = "Document is not an eBloček (missing UID, OKP or NA ÚHRADU markers).";
    upsertManualQueueEntry({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      reason,
      createdAt: now,
    });
    setDecodeJobStatus(
      input.driveFileId,
      input.companyId,
      input.monthKey,
      "failed",
      reason,
      now,
    );
    return;
  }

  const parsed = parseEkasaText(extracted.lines);
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

  const arithmetic = validateEkasaArithmetic(parsed);
  if (!arithmetic.ok) {
    upsertManualQueueEntry({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      reason: arithmetic.reason,
      createdAt: now,
    });
    setDecodeJobStatus(
      input.driveFileId,
      input.companyId,
      input.monthKey,
      "failed",
      arithmetic.reason,
      now,
    );
    return;
  }

  const lineItems = parsed.lineItems.map((item, index) => ({
    sortOrder: index,
    name: item.name,
    vatRateLiteral: item.vatRateLiteral,
    quantityLiteral: item.quantityLiteral,
    unitPriceLiteral: item.unitPriceLiteral,
    lineTotalLiteral: item.lineTotalLiteral,
    lineTotalCents: item.lineTotalCents,
  }));
  const vatRecap = parsed.recapRows.map((row) => ({
    rateLiteral: row.rateLiteral,
    baseLiteral: row.baseLiteral,
    baseCents: row.baseCents,
    vatLiteral: row.vatLiteral,
    vatCents: row.vatCents,
  }));

  if (parsed.currency !== "EUR") {
    upsertCashPayment({
      companyId: input.companyId,
      monthKey: input.monthKey,
      blocekFileId: input.driveFileId,
      amountCents: parsed.totalCents,
      amountLiteral: parsed.totalLiteral,
      currency: parsed.currency,
      receiptAt: parsed.receiptAtUtc,
      receiptTimestampRaw: parsed.timestampRaw,
      ekasaUid: parsed.uid,
      ekasaOkp: parsed.okp,
      supplierName: parsed.supplierName,
      dic: parsed.dic,
      ico: parsed.ico,
      icDph: parsed.icDph,
      kp: parsed.kp,
      receiptNumber: parsed.receiptNumber,
      recapBaseCents: parsed.recapSpoluBaseCents,
      recapBaseLiteral: parsed.recapSpoluBaseLiteral,
      recapVatCents: parsed.recapSpoluVatCents,
      recapVatLiteral: parsed.recapSpoluVatLiteral,
      decodeStatus: "manual",
      lineItems,
      vatRecap,
      createdAt: now,
    });
    upsertManualQueueEntry({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      reason: `Receipt is in ${parsed.currency} — enter the EUR amount manually.`,
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
    amountCents: parsed.totalCents,
    amountLiteral: parsed.totalLiteral,
    currency: parsed.currency,
    receiptAt: parsed.receiptAtUtc,
    receiptTimestampRaw: parsed.timestampRaw,
    ekasaUid: parsed.uid,
    ekasaOkp: parsed.okp,
    supplierName: parsed.supplierName,
    dic: parsed.dic,
    ico: parsed.ico,
    icDph: parsed.icDph,
    kp: parsed.kp,
    receiptNumber: parsed.receiptNumber,
    recapBaseCents: parsed.recapSpoluBaseCents,
    recapBaseLiteral: parsed.recapSpoluBaseLiteral,
    recapVatCents: parsed.recapSpoluVatCents,
    recapVatLiteral: parsed.recapSpoluVatLiteral,
    decodeStatus: "complete",
    lineItems,
    vatRecap,
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
