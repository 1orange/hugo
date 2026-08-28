import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROOF_FOLDER_SLOTS,
  countUntickedPayments,
  derivePaymentStatus,
  isCashPayment,
  isProofFolderSlot,
  listUnpairedPaymentWarnings,
  listUnpairedProofWarnings,
} from "../../../src/modules/reconciliation.ts";
import { CANONICAL_FOLDER_NAMES } from "../../../src/modules/folder-taxonomy.ts";

test("proof folder slots cover received invoices, card receipts and other docs", () => {
  assert.ok(PROOF_FOLDER_SLOTS.includes("02 Prijaté faktúry"));
  assert.ok(PROOF_FOLDER_SLOTS.includes("05 Bločky_firemná karta"));
  assert.ok(PROOF_FOLDER_SLOTS.includes("06 Iné doklady"));
  assert.equal(isProofFolderSlot("04 Bločky_hotovosť"), false);
  assert.equal(isProofFolderSlot(null), false);
});

test("every proof slot is a real canonical folder name", () => {
  // Proof slots are matched against stored slot names, so a proof slot that is
  // not a canonical folder collects nothing and fails silently.
  for (const slot of PROOF_FOLDER_SLOTS) {
    assert.ok(
      (CANONICAL_FOLDER_NAMES as readonly string[]).includes(slot),
      `${slot} is not a canonical folder name`,
    );
  }
});

test("cash payments are self-contained and never need pairing warnings", () => {
  const payment = { id: 1, source: "cash", amountCents: 1000, confirmedAt: null };
  assert.equal(isCashPayment(payment), true);
  assert.deepEqual(derivePaymentStatus(payment, []), {
    kind: "cash-self-contained",
    hint: "Cash bloček — proof is built in",
  });
  assert.deepEqual(listUnpairedPaymentWarnings([payment], []), []);
});

test("bank payments without pairings are warnings", () => {
  const payment = { id: 2, source: "bank", amountCents: 5000, confirmedAt: null };
  assert.deepEqual(derivePaymentStatus(payment, []), {
    kind: "unpaired",
    hint: "No proof paired",
  });
  const warnings = listUnpairedPaymentWarnings([payment], []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.paymentId, 2);
});

test("bank payments with active pairings show paired derived status", () => {
  const payment = { id: 3, source: "bank", amountCents: 3000, confirmedAt: null };
  const pairings = [
    { paymentId: 3, proofDriveFileId: "proof-a", unpairedAt: null },
    { paymentId: 3, proofDriveFileId: "proof-b", unpairedAt: null },
  ];
  assert.deepEqual(derivePaymentStatus(payment, pairings), {
    kind: "paired",
    hint: "2 proofs paired",
  });
  assert.deepEqual(listUnpairedPaymentWarnings([payment], pairings), []);
});

test("unpaired proofs exclude cash bločky and already-paired files", () => {
  const proofs = [
    { driveFileId: "invoice-a", folderSlot: "02 Prijaté faktúry" },
    { driveFileId: "invoice-b", folderSlot: "02 Prijaté faktúry" },
    { driveFileId: "cash-blocek", folderSlot: "04 Bločky_hotovosť" },
  ];
  const pairings = [
    { paymentId: 1, proofDriveFileId: "invoice-a", unpairedAt: null },
  ];
  const cashBlocekFileIds = new Set(["cash-blocek"]);
  const warnings = listUnpairedProofWarnings(proofs, pairings, cashBlocekFileIds);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.driveFileId, "invoice-b");
});

test("many-to-many: one proof paired to two payments is not an unpaired warning", () => {
  const proofs = [{ driveFileId: "invoice-shared", folderSlot: "02 Prijaté faktúry" }];
  const pairings = [
    { paymentId: 1, proofDriveFileId: "invoice-shared", unpairedAt: null },
    { paymentId: 2, proofDriveFileId: "invoice-shared", unpairedAt: null },
  ];
  assert.deepEqual(listUnpairedProofWarnings(proofs, pairings, new Set()), []);
});

test("unpaired pairings are ignored for derived status and warnings", () => {
  const payment = { id: 4, source: "bank", amountCents: 100, confirmedAt: null };
  const pairings = [
    { paymentId: 4, proofDriveFileId: "proof-x", unpairedAt: "2026-01-15T10:00:00.000Z" },
  ];
  assert.deepEqual(derivePaymentStatus(payment, pairings), {
    kind: "unpaired",
    hint: "No proof paired",
  });
});

test("remaining count reads only her tick", () => {
  const payments = [
    { id: 1, confirmedAt: null },
    { id: 2, confirmedAt: "2026-01-10T10:00:00.000Z" },
    { id: 3, confirmedAt: null },
  ];
  assert.equal(countUntickedPayments(payments), 2);
});
