import type { OcrBox } from "../adapters/ocr/port";
import { readingOrderPages, type PositionedText } from "./reading-order";

export type { OcrBox };

function boxesByPage(boxes: readonly OcrBox[]): OcrBox[][] {
  const pages: OcrBox[][] = [];
  for (const box of boxes) {
    const page = box.page ?? 0;
    (pages[page] ??= []).push(box);
  }
  return pages.filter((page) => page !== undefined);
}

/**
 * Rows, as pdf-access groups a text layer: everything at one height, left to
 * right. OCR coordinates are the image's, so the top of the page is y = 0.
 */
export function groupOcrBoxesIntoLines(boxes: readonly OcrBox[]): string[] {
  return boxesByPage(boxes).flatMap((pageBoxes) => {
    const buckets = new Map<number, Array<{ x: number; text: string }>>();
    for (const box of pageBoxes) {
      const text = box.text.normalize("NFC").trim();
      if (text.length === 0) {
        continue;
      }
      const y = Math.round(box.y / 2) * 2;
      if (!buckets.has(y)) {
        buckets.set(y, []);
      }
      buckets.get(y)!.push({ x: box.x, text });
    }
    return [...buckets.keys()]
      .sort((top, lower) => top - lower)
      .map((y) =>
        buckets
          .get(y)!
          .sort((left, right) => left.x - right.x)
          .map((cell) => cell.text)
          .join(" | "),
      );
  });
}

function toPositionedText(box: OcrBox): PositionedText {
  // A box without its size (an older OCR sidecar) is a point; the pages then
  // read roughly as rows.
  return {
    text: box.text,
    left: box.x,
    top: box.y,
    right: box.x + (box.width ?? 0),
    bottom: box.y + (box.height ?? 0),
  };
}

/** The pages in reading order, for the model (reading-order module). */
export function ocrReadingLines(boxes: readonly OcrBox[]): string[] {
  return readingOrderPages(boxesByPage(boxes).map((page) => page.map(toPositionedText)));
}
