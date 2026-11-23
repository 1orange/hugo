import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOT_READ_EXTRACTION_STATUS,
  PROCESSED_FOLDER_SLOTS,
  countAwaitingDecision,
  deriveDocumentStatus,
  deriveReceiptKind,
  hasAutomaticExtraction,
  isDocumentFolderSlot,
  isProcessedFolderSlot,
  isStatementFolderSlot,
} from "../../../src/modules/document-state.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";

test("processed folder slots cover issued and received invoices, receipts and other docs", () => {
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("01 Vystavené faktúry"));
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("02 Prijaté faktúry"));
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("04 Bločky"));
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("04 Bločky"));
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("06 Ostatné dokumenty"));
  assert.equal(isProcessedFolderSlot("03 Bankové výpisy"), false);
  assert.equal(isProcessedFolderSlot("07 Mzdy"), false);
  assert.equal(isProcessedFolderSlot(null), false);
});

test("every processed slot is a real canonical folder name", () => {
  for (const slot of PROCESSED_FOLDER_SLOTS) {
    assert.ok(
      (CANONICAL_FOLDER_NAMES as readonly string[]).includes(slot),
      `${slot} is not a canonical folder name`,
    );
  }
});

test("processed slots are pinned literals, not positions in the canonical list", () => {
  // The canonical list is editable in settings. Deriving these by index means a
  // reorder silently changes which folders are processed and which Omega ledger
  // a receipt lands in, so the values are asserted literally here rather than
  // against the list they must not depend on.
  assert.deepEqual(
    [...PROCESSED_FOLDER_SLOTS],
    [
      "01 Vystavené faktúry",
      "02 Prijaté faktúry",
      "04 Bločky",
      "06 Ostatné dokumenty",
    ],
  );
});

test("a receipt is told by its folder; cash and card are one type (04 Bločky)", () => {
  assert.equal(deriveReceiptKind("04 Bločky"), "receipt");
  assert.equal(deriveReceiptKind("02 Prijaté faktúry"), null);
  assert.equal(deriveReceiptKind("05 Cestovné príkazy"), null);
});

test("derived status is advisory and reflects extraction state", () => {
  // A receipt PDF is genuinely queued for the eKasa parser.
  assert.deepEqual(
    deriveDocumentStatus({
      decision: null,
      extractionStatus: "pending",
      extractionFailureReason: null,
      folderSlot: "04 Bločky",
      mimeType: "application/pdf",
    }),
    { kind: "pending-extraction", hint: "Spracúva sa…" },
  );
  assert.deepEqual(
    deriveDocumentStatus({
      decision: null,
      extractionStatus: "failed",
      extractionFailureReason: "No text layer",
      folderSlot: "04 Bločky",
      mimeType: "application/pdf",
    }),
    { kind: "manual-entry", hint: "No text layer" },
  );
  assert.deepEqual(
    deriveDocumentStatus({
      decision: "confirmed",
      extractionStatus: "complete",
      extractionFailureReason: null,
      folderSlot: "04 Bločky",
      mimeType: "application/pdf",
    }),
    { kind: "extracted", hint: "Spracované" },
  );
});

test("a document no parser handles says so instead of waiting forever", () => {
  assert.deepEqual(
    deriveDocumentStatus({
      decision: null,
      extractionStatus: "pending",
      extractionFailureReason: null,
      folderSlot: "02 Prijaté faktúry",
      mimeType: "application/pdf",
    }),
    { kind: "pending-extraction", hint: "Spracúva sa…" },
  );

  // A photo in a receipt folder has no text layer to read, so it is hers too.
  assert.deepEqual(
    deriveDocumentStatus({
      decision: null,
      extractionStatus: "pending",
      extractionFailureReason: null,
      folderSlot: "04 Bločky",
      mimeType: "image/heic",
    }),
    { kind: "manual-only", hint: "Vyplň ručne" },
  );
});

test("automatic extraction covers text-layer PDFs in processed folders", () => {
  assert.equal(
    hasAutomaticExtraction({
      folderSlot: "04 Bločky",
      mimeType: "application/pdf",
    }),
    true,
  );
  assert.equal(
    hasAutomaticExtraction({
      folderSlot: "04 Bločky",
      mimeType: "application/pdf",
    }),
    true,
  );
  assert.equal(
    hasAutomaticExtraction({
      folderSlot: "04 Bločky",
      mimeType: "image/jpeg",
    }),
    false,
  );
  assert.equal(
    hasAutomaticExtraction({
      folderSlot: "01 Vystavené faktúry",
      mimeType: "application/pdf",
    }),
    true,
  );
  assert.equal(
    hasAutomaticExtraction({
      folderSlot: "02 Prijaté faktúry",
      mimeType: "application/pdf",
    }),
    true,
  );
});

test("awaiting count reads only undecided documents", () => {
  const documents = [
    { decision: null },
    { decision: "confirmed" },
    { decision: "not_relevant" },
    { decision: null },
  ];
  assert.equal(countAwaitingDecision(documents), 2);
});

test("statements are document folders that are never read", () => {
  assert.equal(isStatementFolderSlot("03 Bankové výpisy"), true);
  assert.equal(isStatementFolderSlot("02 Prijaté faktúry"), false);
  assert.equal(isStatementFolderSlot(null), false);
  assert.equal(isDocumentFolderSlot("03 Bankové výpisy"), true);
  assert.equal(isDocumentFolderSlot("04 Bločky"), true);
  assert.equal(isDocumentFolderSlot("07 Mzdy"), false);
  assert.equal(isDocumentFolderSlot(null), false);
  assert.equal(
    hasAutomaticExtraction({ folderSlot: "03 Bankové výpisy", mimeType: "application/pdf" }),
    false,
  );
});

test("a statement's status is not read, whatever her decision", () => {
  const statement = {
    extractionStatus: NOT_READ_EXTRACTION_STATUS,
    extractionFailureReason: null,
    folderSlot: "03 Bankové výpisy",
    mimeType: "application/pdf",
  };
  assert.deepEqual(deriveDocumentStatus({ ...statement, decision: null }), {
    kind: "not-read",
    hint: "Nečíta sa",
  });
  assert.equal(deriveDocumentStatus({ ...statement, decision: "confirmed" }).kind, "not-read");
});
