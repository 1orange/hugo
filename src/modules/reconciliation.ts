/**
 * ponytail: proof slots are pinned to the default folder names, while the
 * canonical list itself is editable in settings (slice 14a). Ceiling: rename
 * "02 Prijaté faktúry" there and proofs silently stop being collected, because
 * stored slot names would no longer match. Upgrade path is a third editable
 * list in settings. Positional indexes into the canonical list are not an
 * option — reordering it would quietly repoint these at other folders.
 *
 * 04 is deliberately absent: cash bločky become payments in their own right
 * (ADR 0002), so treating them as loose proofs would double-count them.
 */
export const PROOF_FOLDER_SLOTS = [
  "02 Prijaté faktúry",
  "05 Bločky_firemná karta",
  "06 Iné doklady",
] as const;

export type ProofFolderSlot = (typeof PROOF_FOLDER_SLOTS)[number];

export type ActivePairing = {
  paymentId: number;
  proofDriveFileId: string;
  unpairedAt: string | null;
};

export type PaymentForReconciliation = {
  id: number;
  source: string;
  amountCents: number | null;
  confirmedAt: string | null;
};

export type ProofForReconciliation = {
  driveFileId: string;
  folderSlot: string | null;
};

export type DerivedPaymentStatus =
  | { kind: "cash-self-contained"; hint: string }
  | { kind: "unpaired"; hint: string }
  | { kind: "paired"; hint: string };

export function isProofFolderSlot(folderSlot: string | null): folderSlot is ProofFolderSlot {
  if (!folderSlot) {
    return false;
  }
  return (PROOF_FOLDER_SLOTS as readonly string[]).includes(folderSlot);
}

export function isCashPayment(payment: { source: string }): boolean {
  return payment.source === "cash";
}

function activePairingsForPayment(
  paymentId: number,
  pairings: ActivePairing[],
): ActivePairing[] {
  return pairings.filter(
    (pairing) => pairing.paymentId === paymentId && pairing.unpairedAt === null,
  );
}

export function derivePaymentStatus(
  payment: PaymentForReconciliation,
  pairings: ActivePairing[],
): DerivedPaymentStatus {
  if (isCashPayment(payment)) {
    return {
      kind: "cash-self-contained",
      hint: "Cash bloček — proof is built in",
    };
  }

  const active = activePairingsForPayment(payment.id, pairings);
  if (active.length === 0) {
    return { kind: "unpaired", hint: "No proof paired" };
  }

  const countLabel = active.length === 1 ? "1 proof paired" : `${active.length} proofs paired`;
  return { kind: "paired", hint: countLabel };
}

export function listUnpairedPaymentWarnings(
  payments: PaymentForReconciliation[],
  pairings: ActivePairing[],
): Array<{ paymentId: number }> {
  return payments
    .filter((payment) => !isCashPayment(payment))
    .filter((payment) => activePairingsForPayment(payment.id, pairings).length === 0)
    .map((payment) => ({ paymentId: payment.id }));
}

export function listUnpairedProofWarnings(
  proofs: ProofForReconciliation[],
  pairings: ActivePairing[],
  cashBlocekFileIds: ReadonlySet<string>,
): Array<{ driveFileId: string }> {
  const pairedProofIds = new Set(
    pairings
      .filter((pairing) => pairing.unpairedAt === null)
      .map((pairing) => pairing.proofDriveFileId),
  );

  return proofs
    .filter((proof) => isProofFolderSlot(proof.folderSlot))
    .filter((proof) => !cashBlocekFileIds.has(proof.driveFileId))
    .filter((proof) => !pairedProofIds.has(proof.driveFileId))
    .map((proof) => ({ driveFileId: proof.driveFileId }));
}

export function countUntickedPayments(
  payments: Array<{ confirmedAt: string | null }>,
): number {
  return payments.filter((payment) => payment.confirmedAt === null).length;
}
