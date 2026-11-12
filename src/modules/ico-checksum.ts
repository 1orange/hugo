/**
 * The check digit of a Slovak or Czech IČO: the first seven digits weighted
 * 8..2, summed, taken mod 11. Remainder 0 gives check digit 1, remainder 1
 * gives 0, otherwise 11 minus the remainder. Real IČOs with remainder 1 exist
 * (Stanica Nivy s.r.o., 50861930), so that case is valid, not rejected.
 */
export function isValidIcoChecksum(ico: string): boolean {
  const digits = ico.replace(/\s/g, "");
  if (!/^\d{8}$/.test(digits)) {
    return false;
  }
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += Number(digits[i]) * weights[i]!;
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  return Number(digits[7]) === checkDigit;
}
