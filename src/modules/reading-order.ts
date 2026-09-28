/**
 * The order a person reads a page in, for the text the model reads.
 *
 * pdf.js and OCR give pieces of text with their positions. Grouping them by
 * height alone reads straight across the page, so an invoice's supplier and
 * customer columns come out interleaved: on her ABC invoice SPRING's IČO
 * landed under "Odberateľ:" and the model gave it to the customer. Here the
 * page is cut along its whitespace (recursive XY-cut) and read a block at a
 * time — left column before right, top to bottom — with an empty line where
 * one column ends.
 *
 * Two sides whose lines share baselines are one set of rows, not two columns:
 * a label and its value, a table's cells. They are never cut apart, so
 * `Variabilný symbol: | 2026081` stays one line. Independent columns share a
 * baseline only by chance.
 */

export type PositionedText = {
  text: string;
  /** Page coordinates, y growing downwards, in any unit (PDF points, pixels). */
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type Gap = { at: number; size: number };

type Scale = {
  /** Narrowest empty band between two columns: wider than a word space. */
  minColumnGap: number;
  /** How far apart two baselines may be and still be one row. */
  rowTolerance: number;
};

/** Share of the smaller side's lines that must meet a line on the other side. */
const SHARED_ROWS = 0.6;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function scaleFor(boxes: readonly PositionedText[]): Scale {
  const height = median(boxes.map((box) => box.bottom - box.top)) || 1;
  return { minColumnGap: height, rowTolerance: height * 0.25 };
}

/** Empty bands between the boxes' extents along one axis. */
function gapsAlong(boxes: readonly PositionedText[], axis: "x" | "y"): Gap[] {
  const spans = boxes
    .map((box) => (axis === "x" ? [box.left, box.right] : [box.top, box.bottom]) as [number, number])
    .sort((left, right) => left[0] - right[0]);
  const gaps: Gap[] = [];
  let end = spans[0]![1];
  for (const [start, stop] of spans.slice(1)) {
    if (start > end) {
      gaps.push({ at: (start + end) / 2, size: start - end });
    }
    end = Math.max(end, stop);
  }
  return gaps;
}

/** The distinct baselines (bottom edges) of a set of boxes. */
function baselines(boxes: readonly PositionedText[], tolerance: number): number[] {
  const found: number[] = [];
  for (const bottom of boxes.map((box) => box.bottom).sort((left, right) => left - right)) {
    if (found.length === 0 || bottom - found[found.length - 1]! > tolerance) {
      found.push(bottom);
    }
  }
  return found;
}

function sharesRows(
  left: readonly PositionedText[],
  right: readonly PositionedText[],
  tolerance: number,
): boolean {
  const leftLines = baselines(left, tolerance);
  const rightLines = baselines(right, tolerance);
  const shared = leftLines.filter((y) =>
    rightLines.some((other) => Math.abs(other - y) <= tolerance),
  ).length;
  return shared / Math.min(leftLines.length, rightLines.length) >= SHARED_ROWS;
}

/** Blocks in reading order; `null` marks where a column ends. */
function cut(boxes: readonly PositionedText[], scale: Scale): Array<PositionedText[] | null> {
  if (boxes.length <= 1) {
    return [[...boxes]];
  }
  const across = gapsAlong(boxes, "y").sort((left, right) => right.size - left.size)[0];
  const column = gapsAlong(boxes, "x")
    .filter((gap) => gap.size >= scale.minColumnGap)
    .sort((left, right) => right.size - left.size)
    .find(
      (gap) =>
        !sharesRows(
          boxes.filter((box) => box.right <= gap.at),
          boxes.filter((box) => box.left >= gap.at),
          scale.rowTolerance,
        ),
    );

  if (column && (!across || column.size >= across.size)) {
    return [
      ...cut(boxes.filter((box) => box.right <= column.at), scale),
      null,
      ...cut(boxes.filter((box) => box.left >= column.at), scale),
    ];
  }
  if (across) {
    return [
      ...cut(boxes.filter((box) => box.bottom <= across.at), scale),
      ...cut(boxes.filter((box) => box.top >= across.at), scale),
    ];
  }
  return [[...boxes]];
}

/** A block's lines: boxes on one baseline, left to right, joined as pdf-access joins cells. */
function blockLines(block: readonly PositionedText[], scale: Scale): string[] {
  const lines: PositionedText[][] = [];
  for (const box of [...block].sort((left, right) => left.bottom - right.bottom)) {
    const line = lines[lines.length - 1];
    if (line && box.bottom - line[0]!.bottom <= scale.rowTolerance) {
      line.push(box);
    } else {
      lines.push([box]);
    }
  }
  return lines.map((line) =>
    line
      .sort((left, right) => left.left - right.left)
      .map((box) => box.text)
      .join(" | "),
  );
}

/** One page's text in reading order. */
export function readingOrderLines(pieces: readonly PositionedText[]): string[] {
  const boxes = pieces
    .map((piece) => ({ ...piece, text: piece.text.normalize("NFC").trim() }))
    .filter((piece) => piece.text.length > 0);
  if (boxes.length === 0) {
    return [];
  }
  const scale = scaleFor(boxes);
  const lines: string[] = [];
  for (const block of cut(boxes, scale)) {
    if (block === null) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      continue;
    }
    lines.push(...blockLines(block, scale));
  }
  while (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/** Several pages in reading order, an empty line between pages. */
export function readingOrderPages(pages: ReadonlyArray<readonly PositionedText[]>): string[] {
  const lines: string[] = [];
  for (const page of pages) {
    const pageLines = readingOrderLines(page);
    if (pageLines.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(...pageLines);
  }
  return lines;
}
