export type OcrBox = {
  text: string;
  x: number;
  y: number;
};

export function groupOcrBoxesIntoLines(boxes: readonly OcrBox[]): string[] {
  const buckets = new Map<number, Array<{ x: number; text: string }>>();

  for (const box of boxes) {
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

  const sortedYs = [...buckets.keys()].sort((left, right) => right - left);
  return sortedYs.map((y) => {
    const row = buckets.get(y)!.sort((left, right) => left.x - right.x);
    return row.map((cell) => cell.text).join(" | ");
  });
}
