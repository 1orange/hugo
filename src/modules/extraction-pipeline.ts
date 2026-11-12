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
 * 3 — an unconfigured model or OCR leaves documents waiting instead of
 *     stubbing or faking them; what failed on the fake OCR is read again.
 * 4 — a text longer than the model's context is cut to fit it (a loan
 *     contract was refused); a garbled text layer goes to OCR, or fails with
 *     what to do about it.
 * 5 — invoice party identity enrichment (safe Slovak DIČ derivation and
 *     company-profile backfill) is part of the extracted result contract.
 * 6 — an invoice settled by an advance keeps its real values: the supply
 *     total, base and VAT, with the deduction kept apart (PRD 0004). Undecided
 *     results still in open months are read again once; decided, exported and
 *     closed-month documents are left alone.
 * 7 — an advance settlement keeps the amounts as read, so her not-settled
 *     decision can restore them, and checks total − advance = due (PRD 0004).
 *     Undecided results in open months are read again once, as in 6.
 */
export const EXTRACTION_PIPELINE_VERSION = 7;

/** Results before this contract must not change merely by opening them. */
export const PARTY_ENRICHMENT_PIPELINE_VERSION = 5;

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

/**
 * An undecided, complete result read by an older pipeline is read once more
 * (PRD 0004: advance-settled invoices). Decided, exported and staged documents
 * keep what she has accepted; a closed month is excluded by the caller.
 */
export function needsPipelineReread(
  document:
    | {
        extractionStatus: string;
        extractionPipelineVersion: number | null;
        decision: string | null;
        exportedAt: string | null;
        replacementPending: boolean;
      }
    | undefined,
): boolean {
  if (!document || document.extractionStatus !== "complete") {
    return false;
  }
  return (
    document.decision === null &&
    document.exportedAt === null &&
    !document.replacementPending &&
    (document.extractionPipelineVersion ?? 0) < EXTRACTION_PIPELINE_VERSION
  );
}
