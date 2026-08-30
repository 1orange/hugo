import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROCESSED_FOLDER_SLOTS,
  countAwaitingDecision,
  deriveDocumentStatus,
  deriveReceiptKind,
  isProcessedFolderSlot,
} from "../../../src/modules/document-state.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";

test("processed folder slots cover issued and received invoices, receipts and other docs", () => {
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("01 Vystavené faktúry"));
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("02 Prijaté faktúry"));
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("04 Bločky_hotovosť"));
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("05 Bločky_firemná karta"));
  assert.ok(PROCESSED_FOLDER_SLOTS.includes("06 Iné doklady"));
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
      "04 Bločky_hotovosť",
      "05 Bločky_firemná karta",
      "06 Iné doklady",
    ],
  );
});

test("cash versus card is derived from folder slot only", () => {
  assert.equal(deriveReceiptKind("04 Bločky_hotovosť"), "cash");
  assert.equal(deriveReceiptKind("05 Bločky_firemná karta"), "card");
  assert.equal(deriveReceiptKind("02 Prijaté faktúry"), null);
});

test("derived status is advisory and reflects extraction state", () => {
  assert.deepEqual(
    deriveDocumentStatus({
      decision: null,
      extractionStatus: "pending",
      extractionFailureReason: null,
      folderSlot: "02 Prijaté faktúry",
    }),
    { kind: "pending-extraction", hint: "Extraction pending" },
  );
  assert.deepEqual(
    deriveDocumentStatus({
      decision: null,
      extractionStatus: "failed",
      extractionFailureReason: "No text layer",
      folderSlot: "04 Bločky_hotovosť",
    }),
    { kind: "manual-entry", hint: "No text layer" },
  );
  assert.deepEqual(
    deriveDocumentStatus({
      decision: "confirmed",
      extractionStatus: "complete",
      extractionFailureReason: null,
      folderSlot: "04 Bločky_hotovosť",
    }),
    { kind: "extracted", hint: "Extracted" },
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
