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
