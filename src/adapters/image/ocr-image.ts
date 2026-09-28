import sharp from "sharp";
import type { PdfPageImage } from "@/adapters/pdf/port";

/**
 * RapidOCR reads a page at most 2000 px on its long side (`max_side_len`) and
 * scales anything larger down itself. A 600 dpi scan is 5088 × 7008 px — sent
 * as raw RGBA it was 140 MB of JSON per page for nothing.
 */
export const OCR_MAX_SIDE_PX = 2000;

/**
 * An image as the OCR should receive it: turned upright from its EXIF (a phone
 * photo lies on its side otherwise), no longer than the OCR reads, grayscale
 * (colour tells a recogniser nothing about text), and PNG — lossless, so small
 * print survives. What sharp cannot read goes as it came.
 */
export async function prepareImageForOcr(image: PdfPageImage): Promise<PdfPageImage> {
  try {
    const source =
      image.kind === "rgba"
        ? sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
            raw: { width: image.width, height: image.height, channels: 4 },
          })
        : sharp(image.bytes);
    const png = await source
      .rotate()
      .resize({ width: OCR_MAX_SIDE_PX, height: OCR_MAX_SIDE_PX, fit: "inside", withoutEnlargement: true })
      // One channel: grayscale() alone still writes three identical ones. A
      // transparent area becomes paper white, not black.
      .flatten({ background: "#ffffff" })
      .toColourspace("b-w")
      .png({ compressionLevel: 6 })
      .toBuffer();
    return { kind: "encoded", bytes: new Uint8Array(png) };
  } catch {
    return image;
  }
}
