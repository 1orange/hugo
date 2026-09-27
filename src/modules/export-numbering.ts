const EXPORT_NUMBER_PATTERN = /^H(\d{2})(\d{2})-(\d{4})$/;

export function exportNumberPrefixForMonth(monthKey: string): string {
  const match = /^(\d{4})_(\d{2})$/.exec(monthKey.trim());
  if (!match) {
    throw new Error("monthKey must look like YYYY_MM");
  }
  const year = match[1]!.slice(-2);
  const month = match[2]!;
  return `H${year}${month}`;
}

export function formatExportNumber(monthKey: string, sequence: number): string {
  const prefix = exportNumberPrefixForMonth(monthKey);
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new Error("sequence must be 1..9999");
  }
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

export function nextExportSequence(
  existingNumbers: readonly string[],
  monthKey: string,
): number {
  const prefix = exportNumberPrefixForMonth(monthKey);
  let max = 0;
  for (const number of existingNumbers) {
    const match = EXPORT_NUMBER_PATTERN.exec(number.trim());
    if (!match || `${match[1]}${match[2]}` !== prefix.slice(1)) {
      continue;
    }
    max = Math.max(max, Number(match[3]!));
  }
  return max + 1;
}
