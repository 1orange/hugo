/**
 * Bumped whenever the pipeline learns to read documents it used to fail on.
 *
 * Without it every improvement reached only new files: a scan that failed with
 * "no extractable text layer" before QR decoding existed stayed failed forever,
 * because discovery skips anything already attempted. A document that failed
 * under an older version — or before versions were recorded — is read once
 * more; a complete one is left alone, since her confirmed values never depend
 * on a re-read anyway.
 *
 * 1 — eKasa UID from QR codes in scans and photos, the OPD lookup, the model
 *     and OCR paths (PRD 0002).
 * 2 — contrast and print-streak QR retries, legal cash rounding, every PDF page
 *     sent to the model.
 */
export const EXTRACTION_PIPELINE_VERSION = 2;

export function needsExtraction(
  document:
    | { extractionStatus: string; extractionPipelineVersion: number | null }
    | undefined,
): boolean {
  if (!document || document.extractionStatus === "pending") {
    return true;
  }
  return (
    document.extractionStatus === "failed" &&
    (document.extractionPipelineVersion ?? 0) < EXTRACTION_PIPELINE_VERSION
  );
}
