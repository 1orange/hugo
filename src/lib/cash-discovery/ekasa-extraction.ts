import type { EkasaLookup } from "@/adapters/ekasa-lookup/port";
import type { PdfAccess } from "@/adapters/pdf/port";
import type { QrReader } from "@/adapters/qr-reader/port";
import {
  findEkasaUidInLines,
  listEkasaUidsFromQrPayloads,
} from "@/modules/ekasa-identifiers";
import {
  findEkasaUidFromQrPayloads,
  isReceiptImageMimeType,
  readQrPayloadsFromPdf,
  readQrPayloadsFromPhoto,
} from "./ekasa-qr-extraction";
import { mapOpdResponseToEkasaPayload } from "@/modules/ekasa-lookup-mapping";
import type { EkasaExtractedPayload } from "@/modules/document-payload";
import {
  isEkasaReceipt,
  parseEkasaText,
  validateEkasaArithmetic,
  type EkasaTextReceipt,
} from "@/modules/ekasa-text";

export function ekasaPayloadFromTextReceipt(
  parsed: EkasaTextReceipt,
): EkasaExtractedPayload {
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

  return {
    kind: "ekasa",
    source: "text-layer",
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
}

export type EkasaExtractionSuccess = {
  ok: true;
  payload: EkasaExtractedPayload;
  source: "lookup" | "text-layer";
};

export type EkasaExtractionFailure = {
  ok: false;
  reason: string;
  /** Set when a QR decode yielded a UID (lookup may still have failed). */
  qrDecodedUid?: string;
};

/** A further receipt found in the same file; it becomes a document of its own. */
export type OtherReceipt = {
  uid: string;
  result: EkasaExtractionSuccess | EkasaExtractionFailure;
};

export type EkasaExtractionResult = (EkasaExtractionSuccess | EkasaExtractionFailure) & {
  otherReceipts?: OtherReceipt[];
};

async function extractEkasaWithUid(input: {
  uid: string;
  lines: string[];
  ekasaLookup: EkasaLookup;
  cachedOpdResponse?: unknown;
}): Promise<EkasaExtractionResult> {
  if (input.cachedOpdResponse !== undefined) {
    const mapped = mapOpdResponseToEkasaPayload({
      requestedUid: input.uid,
      raw: input.cachedOpdResponse,
    });
    if (mapped.ok) {
      return { ok: true, payload: mapped.payload, source: "lookup" };
    }
  }

  const lookup = await input.ekasaLookup.findReceipt(input.uid);
  if (lookup.ok) {
    const mapped = mapOpdResponseToEkasaPayload({
      requestedUid: input.uid,
      raw: lookup.raw,
    });
    if (mapped.ok) {
      return { ok: true, payload: mapped.payload, source: "lookup" };
    }
  }

  if (isEkasaReceipt(input.lines)) {
    const parsed = parseEkasaText(input.lines);
    if (!("ok" in parsed)) {
      const arithmetic = validateEkasaArithmetic(parsed);
      if (arithmetic.ok) {
        return {
          ok: true,
          payload: ekasaPayloadFromTextReceipt(parsed),
          source: "text-layer",
        };
      }
      return { ok: false, reason: arithmetic.reason };
    }
    return { ok: false, reason: parsed.reason };
  }

  const lookupReason = lookup.ok
    ? "Lookup response failed validation."
    : lookup.reason;
  return {
    ok: false,
    reason: lookupReason,
  };
}

export async function extractEkasaFromTextLines(input: {
  lines: string[];
  ekasaLookup: EkasaLookup;
  cachedOpdResponse?: unknown;
}): Promise<EkasaExtractionResult> {
  const uid = findEkasaUidInLines(input.lines);

  if (uid) {
    return extractEkasaWithUid({
      uid,
      lines: input.lines,
      ekasaLookup: input.ekasaLookup,
      cachedOpdResponse: input.cachedOpdResponse,
    });
  }

  if (!isEkasaReceipt(input.lines)) {
    return {
      ok: false,
      reason: "Document is not an eBloček (missing UID, OKP or NA ÚHRADU markers).",
    };
  }

  const parsed = parseEkasaText(input.lines);
  if ("ok" in parsed) {
    return { ok: false, reason: parsed.reason };
  }

  const arithmetic = validateEkasaArithmetic(parsed);
  if (!arithmetic.ok) {
    return { ok: false, reason: arithmetic.reason };
  }

  return {
    ok: true,
    payload: ekasaPayloadFromTextReceipt(parsed),
    source: "text-layer",
  };
}

export async function extractEkasaForReceipt(input: {
  lines: string[];
  hadTextLayer: boolean;
  mimeType: string;
  fileBytes: Uint8Array;
  pdfAccess: PdfAccess;
  qrReader: QrReader;
  ekasaLookup: EkasaLookup;
  cachedOpdResponse?: unknown;
  /** The UID the file's own document already holds, kept on a re-read. */
  preferredUid?: string | null;
  /** Recorded OPD responses of the file's other receipts, by UID. */
  cachedOpdResponsesByUid?: Record<string, unknown>;
}): Promise<EkasaExtractionResult> {
  const textResult = await extractEkasaFromTextLines({
    lines: input.lines,
    ekasaLookup: input.ekasaLookup,
    cachedOpdResponse: input.cachedOpdResponse,
  });
  if (textResult.ok) {
    return textResult;
  }
  if (findEkasaUidInLines(input.lines)) {
    return textResult;
  }

  const canScanQr =
    input.mimeType === "application/pdf" ||
    isReceiptImageMimeType(input.mimeType);
  if (!canScanQr) {
    return textResult;
  }

  const qrPayloads =
    input.mimeType === "application/pdf"
      ? await readQrPayloadsFromPdf(
          input.fileBytes,
          input.pdfAccess,
          input.qrReader,
        )
      : await readQrPayloadsFromPhoto(
          { bytes: input.fileBytes, mimeType: input.mimeType },
          input.qrReader,
        );

  // One document per receipt: a scan of several receipts yields several UIDs.
  const uids = listEkasaUidsFromQrPayloads(qrPayloads);
  if (uids.length > 0) {
    const preferred = input.preferredUid?.trim().toUpperCase();
    const primaryUid = preferred && uids.includes(preferred) ? preferred : uids[0]!;
    const fromQr = await extractEkasaWithUid({
      uid: primaryUid,
      lines: input.lines,
      ekasaLookup: input.ekasaLookup,
      cachedOpdResponse: input.cachedOpdResponse,
    });
    const otherReceipts: OtherReceipt[] = [];
    for (const uid of uids.filter((candidate) => candidate !== primaryUid)) {
      otherReceipts.push({
        uid,
        result: await extractEkasaWithUid({
          uid,
          // The text layer, if any, belongs to the file's first receipt.
          lines: [],
          ekasaLookup: input.ekasaLookup,
          cachedOpdResponse: input.cachedOpdResponsesByUid?.[uid],
        }),
      });
    }
    return fromQr.ok
      ? { ...fromQr, otherReceipts }
      : { ...fromQr, qrDecodedUid: primaryUid, otherReceipts };
  }

  const noCode = await findEkasaUidFromQrPayloads(qrPayloads);
  const noCodeReason = noCode.ok ? textResult.reason : noCode.reason;
  if (!input.hadTextLayer || input.lines.length === 0) {
    return { ok: false, reason: noCodeReason };
  }

  return textResult;
}
