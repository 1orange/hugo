import type { PdfAccess, PdfPageImage } from "@/adapters/pdf/port";
import type { QrDecodeInput, QrReader } from "@/adapters/qr-reader/port";
import { heicToJpeg } from "@/adapters/image/heic-to-jpeg";
import { isHeicMimeType } from "@/modules/file-preview";
import {
  findEkasaUidInText,
  pickEkasaUidFromQrPayloads,
} from "@/modules/ekasa-identifiers";

export const NO_EKASA_CODE_REASON = "no eKasa code found";

export function isReceiptImageMimeType(mimeType: string): boolean {
  const normalized = mimeType.split(";")[0]!.trim().toLowerCase();
  return (
    normalized === "image/jpeg" ||
    normalized === "image/jpg" ||
    isHeicMimeType(mimeType)
  );
}

function pageImageToQrInput(image: PdfPageImage): QrDecodeInput {
  if (image.kind === "encoded") {
    return { kind: "encoded", bytes: image.bytes };
  }
  return {
    kind: "rgba",
    image: { data: image.data, width: image.width, height: image.height },
  };
}

/** Retry until an eKasa code turns up; any other code alone is not enough. */
const UNTIL_EKASA_CODE = {
  until: (codes: readonly string[]) => codes.some((code) => findEkasaUidInText(code) !== null),
};

export async function readQrPayloadsFromImages(
  images: readonly PdfPageImage[],
  qrReader: QrReader,
): Promise<string[]> {
  const payloads: string[] = [];
  for (const image of images) {
    const codes = await qrReader.readAllCodes(pageImageToQrInput(image), UNTIL_EKASA_CODE);
    payloads.push(...codes);
  }
  return payloads;
}

export async function readQrPayloadsFromPhoto(
  input: { bytes: Uint8Array; mimeType: string },
  qrReader: QrReader,
): Promise<string[]> {
  const jpegBytes = isHeicMimeType(input.mimeType)
    ? await heicToJpeg(input.bytes)
    : input.bytes;
  return qrReader.readAllCodes({ kind: "encoded", bytes: jpegBytes }, UNTIL_EKASA_CODE);
}

export async function readQrPayloadsFromPdf(
  pdfBytes: Uint8Array,
  pdfAccess: PdfAccess,
  qrReader: QrReader,
): Promise<string[]> {
  const images = await pdfAccess.extractPageImages(pdfBytes);
  return readQrPayloadsFromImages(images, qrReader);
}

export async function findEkasaUidFromQrPayloads(
  payloads: readonly string[],
): Promise<
  | { ok: true; uid: string }
  | { ok: false; reason: string }
> {
  const picked = pickEkasaUidFromQrPayloads(payloads);
  if (picked.status === "found") {
    return { ok: true, uid: picked.uid };
  }
  if (picked.status === "conflict") {
    return { ok: false, reason: picked.reason };
  }
  return { ok: false, reason: NO_EKASA_CODE_REASON };
}
