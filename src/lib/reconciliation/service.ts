import { appendUserEvent } from "@/adapters/store/events";
import {
  createPairing,
  getActivePairing,
  getPairingById,
  unpairPairing,
} from "@/adapters/store/pairings";
import {
  getPaymentById,
  setPaymentConfirmedAt,
  updatePaymentNote,
} from "@/adapters/store/payments";
import { getProof, updateProofNote } from "@/adapters/store/proofs";
import { assertMonthEditable } from "@/lib/month-lifecycle/service";

export type ReconciliationActionResult =
  | { ok: true }
  | { ok: false; message: string };

export function pairPaymentWithProof(input: {
  companyId: number;
  monthKey: string;
  paymentId: number;
  proofDriveFileId: string;
  now?: string;
}): ReconciliationActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const payment = getPaymentById(input.paymentId);
  if (!payment || payment.companyId !== input.companyId || payment.monthKey !== input.monthKey) {
    return { ok: false, message: "Payment not found in this month." };
  }

  if (payment.source === "cash") {
    return { ok: false, message: "Cash bločky do not need pairing." };
  }

  const proof = getProof(input.proofDriveFileId);
  if (!proof || proof.companyId !== input.companyId || proof.monthKey !== input.monthKey) {
    return { ok: false, message: "Proof not found in this month." };
  }

  if (getActivePairing(input.paymentId, input.proofDriveFileId)) {
    return { ok: false, message: "Already paired." };
  }

  const now = input.now ?? new Date().toISOString();
  createPairing({
    paymentId: input.paymentId,
    proofDriveFileId: input.proofDriveFileId,
    createdBy: "manual",
    reason: "manual",
    createdAt: now,
  });

  appendUserEvent(now, input.companyId, "Paired", {
    monthKey: input.monthKey,
    paymentId: input.paymentId,
    proofDriveFileId: input.proofDriveFileId,
    createdBy: "manual",
  });

  return { ok: true };
}

export function unpairPaymentFromProof(input: {
  companyId: number;
  monthKey: string;
  pairingId: number;
  now?: string;
}): ReconciliationActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const pairing = getPairingById(input.pairingId);
  if (!pairing || pairing.unpairedAt) {
    return { ok: false, message: "Pairing not found." };
  }

  const payment = getPaymentById(pairing.paymentId);
  if (!payment || payment.companyId !== input.companyId || payment.monthKey !== input.monthKey) {
    return { ok: false, message: "Pairing not found in this month." };
  }

  const now = input.now ?? new Date().toISOString();
  unpairPairing(input.pairingId, now);

  appendUserEvent(now, input.companyId, "Unpaired", {
    monthKey: input.monthKey,
    paymentId: pairing.paymentId,
    proofDriveFileId: pairing.proofDriveFileId,
    pairingId: input.pairingId,
  });

  return { ok: true };
}

export function confirmPayment(input: {
  companyId: number;
  monthKey: string;
  paymentId: number;
  confirmed: boolean;
  now?: string;
}): ReconciliationActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const payment = getPaymentById(input.paymentId);
  if (!payment || payment.companyId !== input.companyId || payment.monthKey !== input.monthKey) {
    return { ok: false, message: "Payment not found in this month." };
  }

  const now = input.now ?? new Date().toISOString();
  setPaymentConfirmedAt(input.paymentId, input.confirmed ? now : null);

  if (input.confirmed) {
    appendUserEvent(now, input.companyId, "Confirmed", {
      monthKey: input.monthKey,
      paymentId: input.paymentId,
    });
  }

  return { ok: true };
}

export function savePaymentNote(input: {
  companyId: number;
  monthKey: string;
  paymentId: number;
  note: string;
}): ReconciliationActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const payment = getPaymentById(input.paymentId);
  if (!payment || payment.companyId !== input.companyId || payment.monthKey !== input.monthKey) {
    return { ok: false, message: "Payment not found in this month." };
  }

  updatePaymentNote(input.paymentId, input.note.trim() || null);
  return { ok: true };
}

export function saveProofNote(input: {
  companyId: number;
  monthKey: string;
  proofDriveFileId: string;
  note: string;
}): ReconciliationActionResult {
  const readOnly = assertMonthEditable(input.companyId, input.monthKey);
  if (readOnly) {
    return readOnly;
  }

  const proof = getProof(input.proofDriveFileId);
  if (!proof || proof.companyId !== input.companyId || proof.monthKey !== input.monthKey) {
    return { ok: false, message: "Proof not found in this month." };
  }

  updateProofNote(input.proofDriveFileId, input.note.trim() || null);
  return { ok: true };
}
