import { findEkasaUidInLines } from "@/modules/ekasa-identifiers";
import { isEkasaReceipt } from "@/modules/ekasa-text";

export function shouldExtractWithModel(input: {
  lines: string[];
  hadTextLayer: boolean;
  fromOcr?: boolean;
}): boolean {
  if (input.lines.length === 0) {
    return false;
  }
  if (!input.hadTextLayer && !input.fromOcr) {
    return false;
  }
  if (findEkasaUidInLines(input.lines)) {
    return false;
  }
  if (isEkasaReceipt(input.lines)) {
    return false;
  }
  return true;
}

/** A receipt the eKasa lookup reads, by its UID or its printed eKasa form, not the model. */
export function looksLikeEkasaReceipt(lines: string[]): boolean {
  return lines.length > 0 && (findEkasaUidInLines(lines) !== null || isEkasaReceipt(lines));
}
