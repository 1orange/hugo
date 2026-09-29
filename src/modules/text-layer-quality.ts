/**
 * Whether a PDF's text layer reads as text at all. A PDF saved again from
 * Safari ("Uložiť ako PDF") kept the page's look but wrote glyph numbers for
 * characters: "Autoservis s. r. o." came out as "$XWRVHUYLV V. U. R.",
 * each character 29 code points early — TrueType's glyph order. The model
 * returned nothing parseable from it, while OCR reads the page as printed.
 *
 * A letter shifted so turns lowercase into capitals and most vowels into
 * consonants. Measured on her 179 text layers: vowels ≥ 36% of the letters
 * and lowercase ≥ 55% (receipts printed in capitals) in every real one; 21%
 * and 22% in the two garbled ones. Both must fail.
 */
const MIN_LETTERS = 100;
const MIN_VOWEL_SHARE = 0.33;
const MIN_LOWERCASE_SHARE = 0.4;

export function textLayerLooksGarbled(lines: readonly string[]): boolean {
  const letters = lines.join(" ").normalize("NFD").match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_LETTERS) {
    return false;
  }
  const vowels = letters.filter((letter) => /[aeiouy]/i.test(letter)).length;
  const lowercase = letters.filter((letter) => letter !== letter.toUpperCase()).length;
  return vowels / letters.length < MIN_VOWEL_SHARE && lowercase / letters.length < MIN_LOWERCASE_SHARE;
}
