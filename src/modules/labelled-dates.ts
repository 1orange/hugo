import { normalizeModelDate } from "./model-output-normalize";

/**
 * The dates a document prints beside a label saying what they are. Qwen3 4B
 * took Bonami's due date for its taxable supply date although the invoice
 * prints "Dátum splatnosti: | 17.05.2026" and "Dátum daňovej povinnosti: |
 * 03.05.2026": a value that is right there, only under the wrong label, passes
 * every other check.
 */
export type DateLabel = "issue" | "taxable" | "due";

// Matched without diacritics, lower case: Slovak and Czech labels, as printed.
const LABELS: Array<{ kind: DateLabel; pattern: RegExp }> = [
  { kind: "due", pattern: /splatnost/ },
  { kind: "taxable", pattern: /duzp|zdanitel|danovej povinnost|danove povinnost|dodani|dodanie|datum plneni/ },
  { kind: "issue", pattern: /vystaven|vyhotoven/ },
];
const DATE = /(\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})/;

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** ISO date → the labels printed before it on its line. */
export function labelledDates(lines: readonly string[]): Map<string, Set<DateLabel>> {
  const found = new Map<string, Set<DateLabel>>();
  for (const line of lines) {
    // Each label owns the text up to the next label on the line.
    const folded = fold(line);
    const starts: Array<{ index: number; kind: DateLabel }> = [];
    for (const { kind, pattern } of LABELS) {
      const global = new RegExp(pattern.source, "g");
      for (const match of folded.matchAll(global)) {
        starts.push({ index: match.index, kind });
      }
    }
    starts.sort((left, right) => left.index - right.index);
    starts.forEach((start, position) => {
      const end = starts[position + 1]?.index ?? folded.length;
      const date = normalizeModelDate(DATE.exec(folded.slice(start.index, end))?.[1] ?? null);
      if (date) {
        const kinds = found.get(date) ?? new Set<DateLabel>();
        kinds.add(start.kind);
        found.set(date, kinds);
      }
    });
  }
  return found;
}

/**
 * True when the text labels `date` only as the due date and labels another
 * date as the issue or taxable supply date — the model read the wrong label.
 */
export function isLabelledOnlyAsDue(date: string | null, labels: Map<string, Set<DateLabel>>): boolean {
  if (!date) {
    return false;
  }
  const kinds = labels.get(date);
  if (!kinds || !kinds.has("due") || kinds.has("taxable") || kinds.has("issue")) {
    return false;
  }
  return [...labels].some(([other, otherKinds]) => other !== date && (otherKinds.has("taxable") || otherKinds.has("issue")));
}
