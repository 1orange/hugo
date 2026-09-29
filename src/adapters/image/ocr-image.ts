import sharp, { type Region, type Sharp } from "sharp";
import type { PdfPageImage } from "@/adapters/pdf/port";

/**
 * RapidOCR reads a page at most 2000 px on its long side (`max_side_len`) and
 * scales anything larger down itself. A 600 dpi scan is 5088 × 7008 px — sent
 * as raw RGBA it was 140 MB of JSON per page for nothing.
 */
export const OCR_MAX_SIDE_PX = 2000;

// Where the page's print is, found on a copy this size.
const PROBE_SIDE_PX = 1000;
// Darker than this is print; scanner noise and paper grain are lighter.
const INK_LEVEL = 160;
// The scanner's own edges (a lid shadow, a black line) are not the document.
const EDGE_SHARE = 0.02;
// A row or column of the probe needs this much ink: one speck of dust is not print.
const MIN_INK_PIXELS = 2;
// Print covering most of the page is left as it is: a photo, a full invoice.
const MAX_CROPPED_AREA_SHARE = 0.7;

/**
 * The part of the page with print on it, when that is much less than the
 * page. A receipt scanned on an A4 page fills a quarter of its width; scaled
 * to the OCR's 2000 px as a whole page, its letters were 10 px high and "IČO:
 * 50 861 930" read as "1C0 90 80 :930". Cropped first, it reads as printed.
 */
async function printedArea(
  gray: () => Sharp,
  width: number,
  height: number,
): Promise<Region | null> {
  const { data, info } = await gray()
    .resize({ width: PROBE_SIDE_PX, height: PROBE_SIDE_PX, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const edge = Math.round(Math.min(info.width, info.height) * EDGE_SHARE);
  const rows = new Array<number>(info.height).fill(0);
  const columns = new Array<number>(info.width).fill(0);
  for (let y = edge; y < info.height - edge; y += 1) {
    for (let x = edge; x < info.width - edge; x += 1) {
      if (data[(y * info.width + x) * info.channels]! < INK_LEVEL) {
        rows[y]! += 1;
        columns[x]! += 1;
      }
    }
  }
  const inked = (counts: number[]) => counts.flatMap((count, index) => (count >= MIN_INK_PIXELS ? [index] : []));
  const inkedRows = inked(rows);
  const inkedColumns = inked(columns);
  if (inkedRows.length === 0 || inkedColumns.length === 0) {
    return null;
  }
  const scale = width / info.width;
  const pad = Math.round(Math.max(width, height) * 0.01);
  const left = Math.max(0, Math.floor(inkedColumns[0]! * scale) - pad);
  const top = Math.max(0, Math.floor(inkedRows[0]! * scale) - pad);
  const right = Math.min(width, Math.ceil((inkedColumns.at(-1)! + 1) * scale) + pad);
  const bottom = Math.min(height, Math.ceil((inkedRows.at(-1)! + 1) * scale) + pad);
  if ((right - left) * (bottom - top) > width * height * MAX_CROPPED_AREA_SHARE) {
    return null;
  }
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * An image as the OCR should receive it: turned upright from its EXIF (a phone
 * photo lies on its side otherwise), grayscale (colour tells a recogniser
 * nothing about text), cut to its print (printedArea), no longer than the OCR
 * reads, and PNG — lossless, so small print survives. What sharp cannot read
 * goes as it came.
 */
export async function prepareImageForOcr(image: PdfPageImage): Promise<PdfPageImage> {
  try {
    const source =
      image.kind === "rgba"
        ? sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
            raw: { width: image.width, height: image.height, channels: 4 },
          })
        : sharp(image.bytes);
    // One channel: grayscale() alone still writes three identical ones. A
    // transparent area becomes paper white, not black.
    const { data, info } = await source
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const gray = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    const area = await printedArea(gray, info.width, info.height);
    const png = await (area ? gray().extract(area) : gray())
      .resize({ width: OCR_MAX_SIDE_PX, height: OCR_MAX_SIDE_PX, fit: "inside", withoutEnlargement: true })
      // sharp writes sRGB unless told otherwise.
      .toColourspace("b-w")
      .png({ compressionLevel: 6 })
      .toBuffer();
    return { kind: "encoded", bytes: new Uint8Array(png) };
  } catch {
    return image;
  }
}
