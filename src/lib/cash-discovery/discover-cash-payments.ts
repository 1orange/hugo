import {
  isEkasaReceipt,
  parseEkasaText,
  validateEkasaArithmetic,
} from "@/modules/ekasa-text";
import type { DriveClient } from "@/adapters/drive/port";
import type { PdfAccess } from "@/adapters/pdf/port";
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
import { emptyExtractedPayload } from "@/modules/document-payload";

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
    pdfBytes: Uint8Array;
  },
  deps: Pick<CashDiscoveryDeps, "pdfAccess" | "now">,
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

  const extracted = await extractReceiptTextLines(input.pdfBytes, deps.pdfAccess);
  if (!extracted.ok) {
    markManualEntry({
      driveFileId: input.driveFileId,
      reason: extracted.reason,
    });
    return;
  }

  if (!isEkasaReceipt(extracted.lines)) {
    const reason =
      "Document is not an eBloček (missing UID, OKP or NA ÚHRADU markers).";
    markManualEntry({
      driveFileId: input.driveFileId,
      reason,
    });
    return;
  }

  const parsed = parseEkasaText(extracted.lines);
  if ("ok" in parsed) {
    markManualEntry({
      driveFileId: input.driveFileId,
      reason: parsed.reason,
    });
    return;
  }

  const arithmetic = validateEkasaArithmetic(parsed);
  if (!arithmetic.ok) {
    markManualEntry({
      driveFileId: input.driveFileId,
      reason: arithmetic.reason,
    });
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

  const payload = {
    kind: "ekasa" as const,
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
    lineItems,
    vatRecap,
  };

  if (parsed.currency !== "EUR") {
    upsertEkasaExtractedPayload({
      driveFileId: input.driveFileId,
      companyId: input.companyId,
      monthKey: input.monthKey,
      folderSlot: input.folderSlot,
      payload,
      extractionStatus: "failed",
      extractionFailureReason: `Receipt is in ${parsed.currency} — enter the EUR amount manually.`,
      createdAt: now,
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
        file.mimeType === "application/pdf",
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

    const pdfBytes = await deps.driveClient.download(file.driveFileId);
    await processCashReceiptFile(
      {
        companyId,
        monthKey,
        driveFileId: file.driveFileId,
        folderSlot: file.folderSlot,
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
    // ponytail: month view stays fast; failures surface via extraction state
  });
}
