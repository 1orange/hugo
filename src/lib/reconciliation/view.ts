import { getCompanyById } from "@/adapters/store/companies";
import { listFilesForMonth } from "@/adapters/store/files";
import { getMonthByKey, getOpenMonthKey } from "@/adapters/store/months";
import { listAllPairingsForPayments } from "@/adapters/store/pairings";
import { listPaymentsForMonth } from "@/adapters/store/payments";
import { ensureProofsForMonth, listProofsForMonth } from "@/adapters/store/proofs";
import { formatEuroFromCents } from "@/modules/money";
import {
  countUntickedPayments,
  derivePaymentStatus,
  isProofFolderSlot,
  listUnpairedPaymentWarnings,
  listUnpairedProofWarnings,
  type DerivedPaymentStatus,
} from "@/modules/reconciliation";

export type ReconciliationPaymentItem = {
  id: number;
  source: string;
  label: string;
  amountDisplay: string;
  receiptDisplay: string;
  confirmed: boolean;
  note: string | null;
  derivedStatus: DerivedPaymentStatus;
  pairedProofIds: string[];
  pairingIdsByProofId: Record<string, number>;
  blocekFileId: string | null;
  needsPairing: boolean;
};

export type ReconciliationProofItem = {
  driveFileId: string;
  name: string;
  folderSlot: string;
  mimeType: string;
  note: string | null;
  pairedPaymentIds: number[];
  pairingIdsByPaymentId: Record<number, number>;
};

export type ReconciliationView = {
  companyName: string;
  monthKey: string;
  readOnly: boolean;
  isOpenMonth: boolean;
  untickedCount: number;
  folderFilter: string | null;
  payments: ReconciliationPaymentItem[];
  unpairedProofs: ReconciliationProofItem[];
  pairedProofs: ReconciliationProofItem[];
  unpairedPaymentWarnings: Array<{ paymentId: number; label: string }>;
  unpairedProofWarnings: Array<{ driveFileId: string; name: string }>;
};

function formatReceiptAt(receiptAt: string | null): string {
  if (!receiptAt) {
    return "—";
  }
  return new Intl.DateTimeFormat("sk-SK", {
    timeZone: "Europe/Bratislava",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(receiptAt));
}

function formatPaymentAmount(
  amountLiteral: string | null,
  amountCents: number | null,
  currency: string,
): string {
  if (amountLiteral) {
    return `${amountLiteral} ${currency}`;
  }
  if (amountCents !== null) {
    return `${formatEuroFromCents(amountCents)} ${currency}`;
  }
  return "—";
}

function paymentLabel(
  payment: {
    source: string;
    supplierName: string | null;
    amountLiteral: string | null;
    amountCents: number | null;
    currency: string;
  },
  documentName: string | null,
): string {
  if (payment.source === "cash") {
    return documentName ?? "Cash bloček";
  }
  if (payment.supplierName) {
    return payment.supplierName;
  }
  return formatPaymentAmount(
    payment.amountLiteral,
    payment.amountCents,
    payment.currency,
  );
}

export function buildReconciliationView(
  companyId: number,
  monthKey: string,
  folderFilter?: string | null,
): ReconciliationView | null {
  const company = getCompanyById(companyId);
  if (!company) {
    return null;
  }

  const month = getMonthByKey(companyId, monthKey);
  if (!month) {
    return null;
  }

  const now = new Date().toISOString();
  ensureProofsForMonth(companyId, monthKey, now);

  const files = listFilesForMonth(companyId, monthKey);
  const fileById = new Map(files.map((file) => [file.driveFileId, file]));
  const payments = listPaymentsForMonth(companyId, monthKey);
  const paymentIds = payments.map((payment) => payment.id);
  const pairings = listAllPairingsForPayments(paymentIds);
  const proofs = listProofsForMonth(companyId, monthKey);
  const cashBlocekFileIds = new Set(
    payments
      .map((payment) => payment.blocekFileId)
      .filter((id): id is string => id !== null),
  );

  const activePairings = pairings.filter((pairing) => pairing.unpairedAt === null);
  const pairedProofIds = new Set(activePairings.map((pairing) => pairing.proofDriveFileId));

  const paymentItems: ReconciliationPaymentItem[] = payments.map((payment) => {
    const documentName = payment.blocekFileId
      ? fileById.get(payment.blocekFileId)?.name ?? null
      : null;
    const paymentPairings = activePairings.filter(
      (pairing) => pairing.paymentId === payment.id,
    );
    const pairingIdsByProofId: Record<string, number> = {};
    for (const pairing of paymentPairings) {
      pairingIdsByProofId[pairing.proofDriveFileId] = pairing.id;
    }

    return {
      id: payment.id,
      source: payment.source,
      label: paymentLabel(payment, documentName),
      amountDisplay: formatPaymentAmount(
        payment.amountLiteral,
        payment.amountCents,
        payment.currency,
      ),
      receiptDisplay: formatReceiptAt(payment.receiptAt),
      confirmed: payment.confirmedAt !== null,
      note: payment.note,
      derivedStatus: derivePaymentStatus(payment, pairings),
      pairedProofIds: paymentPairings.map((pairing) => pairing.proofDriveFileId),
      pairingIdsByProofId,
      blocekFileId: payment.blocekFileId,
      needsPairing: payment.source !== "cash",
    };
  });

  const proofItems: ReconciliationProofItem[] = proofs
    .map((proof) => {
      const file = fileById.get(proof.driveFileId);
      if (!file || file.deleted) {
        return null;
      }
      const proofPairings = activePairings.filter(
        (pairing) => pairing.proofDriveFileId === proof.driveFileId,
      );
      const pairingIdsByPaymentId: Record<number, number> = {};
      for (const pairing of proofPairings) {
        pairingIdsByPaymentId[pairing.paymentId] = pairing.id;
      }
      return {
        driveFileId: proof.driveFileId,
        name: file.name,
        folderSlot: file.folderSlot ?? "",
        mimeType: file.mimeType,
        note: proof.note,
        pairedPaymentIds: proofPairings.map((pairing) => pairing.paymentId),
        pairingIdsByPaymentId,
      };
    })
    .filter((item): item is ReconciliationProofItem => item !== null)
    .filter((item) => !folderFilter || item.folderSlot === folderFilter);

  const unpairedProofs = proofItems.filter(
    (proof) => !pairedProofIds.has(proof.driveFileId),
  );
  const pairedProofs = proofItems.filter((proof) =>
    pairedProofIds.has(proof.driveFileId),
  );

  const unpairedPaymentWarnings = listUnpairedPaymentWarnings(payments, pairings).map(
    (warning) => {
      const payment = payments.find((entry) => entry.id === warning.paymentId)!;
      return {
        paymentId: warning.paymentId,
        label: paymentLabel(
          payment,
          payment.blocekFileId
            ? fileById.get(payment.blocekFileId)?.name ?? null
            : null,
        ),
      };
    },
  );

  const unpairedProofWarnings = listUnpairedProofWarnings(
    proofs.map((proof) => ({
      driveFileId: proof.driveFileId,
      folderSlot: fileById.get(proof.driveFileId)?.folderSlot ?? null,
    })),
    pairings,
    cashBlocekFileIds,
  ).map((warning) => ({
    driveFileId: warning.driveFileId,
    name: fileById.get(warning.driveFileId)?.name ?? warning.driveFileId,
  }));

  const openMonthKey = getOpenMonthKey(companyId);

  return {
    companyName: company.name,
    monthKey,
    readOnly: month.closedAt !== null,
    isOpenMonth: openMonthKey === monthKey,
    untickedCount: countUntickedPayments(payments),
    folderFilter: folderFilter ?? null,
    payments: paymentItems,
    unpairedProofs,
    pairedProofs,
    unpairedPaymentWarnings,
    unpairedProofWarnings,
  };
}

export function listProofFolderFilters(
  companyId: number,
  monthKey: string,
): string[] {
  const files = listFilesForMonth(companyId, monthKey);
  const slots = new Set<string>();
  for (const file of files) {
    if (isProofFolderSlot(file.folderSlot)) {
      slots.add(file.folderSlot);
    }
  }
  return [...slots].sort();
}
