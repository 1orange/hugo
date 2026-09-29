/**
 * The text the model reads, without what cannot change its answer. Reading
 * the prompt is over half of a document's model time on CPU (1,000–1,700
 * tokens at ~50 a second for Qwen3 4B), so every line it need not read counts.
 * Only lines that carry nothing are dropped:
 *
 * - a line repeated verbatim — Omega prints the customer's address twice and
 *   its footer on every page; the first copy is kept. Only lines long enough
 *   to be an address or a sentence: a short one ("23 %", "ks") is a table
 *   cell, and a table may repeat it;
 * - a page number spelled out ("Strana 1 z 2", "1/2") — never a bare number,
 *   which in a column may be a VAT rate;
 * - blank lines beyond one, which only separate columns.
 */
const PAGE_NUMBER = /^(?:(?:strana|str\.|page|seite)\s*\d{1,3}(?:\s*(?:\/|z|of|von)\s*\d{1,3})?|\d{1,3}\s*\/\s*\d{1,3})$/i;
const MIN_DEDUPLICATED_LENGTH = 12;

export function trimLinesForModel(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (kept.length > 0 && kept[kept.length - 1] !== "") {
        kept.push("");
      }
      continue;
    }
    if (PAGE_NUMBER.test(line)) {
      continue;
    }
    if (line.length >= MIN_DEDUPLICATED_LENGTH) {
      if (seen.has(line)) {
        continue;
      }
      seen.add(line);
    }
    kept.push(line);
  }
  while (kept[kept.length - 1] === "") {
    kept.pop();
  }
  return kept;
}

/**
 * The fewest characters one token covers in her documents' text layers
 * (Qwen3 4B): 1.6 on the densest invoices, ~2.2 on prose. Only a garbled
 * text layer went lower (1.25) — it is read by OCR instead.
 */
export const MIN_CHARS_PER_TOKEN = 1.5;

/** Stands in for what `fitLinesToCharBudget` left out, so the model knows the text has a gap. */
export const OMITTED_LINES_MARKER = "[…]";

/**
 * The text, cut to fit the model's context. A five-page loan contract was
 * 9,550 tokens against 8,192, and llama.cpp refuses the whole request. The
 * header fields are at the start and the totals at the end, so the middle —
 * item lines, terms — goes: two thirds of the budget from the start, one
 * third from the end, whole lines only.
 */
export function fitLinesToCharBudget(lines: readonly string[], maxChars: number): string[] {
  const size = (line: string) => line.length + 1;
  if (lines.reduce((total, line) => total + size(line), 0) <= maxChars) {
    return [...lines];
  }
  const budget = Math.max(0, maxChars - size(OMITTED_LINES_MARKER));
  const head: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + size(line) > (budget * 2) / 3) {
      break;
    }
    head.push(line);
    used += size(line);
  }
  const tail: string[] = [];
  for (let index = lines.length - 1; index >= head.length; index -= 1) {
    const line = lines[index]!;
    if (used + size(line) > budget) {
      break;
    }
    tail.unshift(line);
    used += size(line);
  }
  return [...head, OMITTED_LINES_MARKER, ...tail];
}
