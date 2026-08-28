import { getCompanyById, listCompanies } from "@/adapters/store/companies";
import { getActiveMutationForFolder } from "@/adapters/store/drive-mutations";
import { listFilesForMonth } from "@/adapters/store/files";
import { listMonthFolders } from "@/adapters/store/month-folders";
import {
  countUntickedPayments,
  companyHasPayments,
  listCashPaymentsForMonth,
  listManualQueueForMonth,
  listPendingDecodeJobsForMonth,
} from "@/adapters/store/payments";
import {
  getMonthByKey,
  getOpenMonthKey,
} from "@/adapters/store/months";
import { getSettings } from "@/adapters/store/settings";
import { formatEuroFromCents } from "@/modules/money";
import { classifyFolder } from "@/modules/folder-taxonomy";
import {
  deriveCompanyStage,
  type CompanyStage,
} from "@/modules/month-lifecycle";

export type CompanyListItem = {
  id: number;
  name: string;
  openMonth: string | null;
  stage: CompanyStage;
  untickedCount: number | null;
};

export type MonthPaymentItem = {
  id: number;
  amountLiteral: string | null;
  amountDisplay: string;
  receiptAt: string | null;
  receiptDisplay: string;
  blocekFileId: string;
  documentName: string;
  decodeStatus: string;
};

export type MonthManualQueueItem = {
  driveFileId: string;
  documentName: string;
  reason: string;
};

export type MonthDocumentGroup = {
  driveFolderId: string;
  title: string;
  kind: "canonical" | "repair-candidate" | "unknown" | "vat-output";
  observedName: string;
  proposedTargetName: string | null;
  canRename: boolean;
  renameBlockedReason: string | null;
  activeMutationId: number | null;
  documents: Array<{
    driveFileId: string;
    name: string;
    deleted: boolean;
  }>;
};

export function listCompanySummaries(): CompanyListItem[] {
  return listCompanies().map((company) => {
    const openMonth = getOpenMonthKey(company.id);
    const untickedCount =
      openMonth === null ? null : countUntickedPayments(company.id, openMonth);
    const stageView = deriveCompanyStage({
      openMonthKey: openMonth,
      untickedCount,
      hasPayments: companyHasPayments(company.id),
    });
    return {
      id: company.id,
      name: company.name,
      openMonth,
      stage: stageView.stage,
      untickedCount: stageView.untickedCount,
    };
  });
}

function renameBlockedReason(canRename: boolean): string | null {
  if (!canRename) {
    return "Drive reports this folder cannot be renamed. It may be owned by the client or shared with restricted permissions.";
  }
  return null;
}

function formatReceiptAt(receiptAt: string | null): string {
  if (!receiptAt) {
    return "Pending timestamp";
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
): string {
  if (amountLiteral) {
    return `${amountLiteral} EUR`;
  }
  if (amountCents !== null) {
    return `${formatEuroFromCents(amountCents)} EUR`;
  }
  return "Pending amount";
}

export function buildMonthView(
  companyId: number,
  monthKey: string,
): {
  companyName: string;
  monthKey: string;
  canonicalFolderNames: string[];
  readOnly: boolean;
  isOpenMonth: boolean;
  closedAt: string | null;
  cashPayments: MonthPaymentItem[];
  pendingDecodeCount: number;
  manualQueue: MonthManualQueueItem[];
  groups: MonthDocumentGroup[];
} | null {
  const company = getCompanyById(companyId);
  if (!company) {
    return null;
  }

  const month = getMonthByKey(companyId, monthKey);
  if (!month) {
    return null;
  }

  const openMonthKey = getOpenMonthKey(companyId);
  const settings = getSettings();
  const files = listFilesForMonth(companyId, monthKey);
  const fileNameById = new Map(files.map((file) => [file.driveFileId, file.name]));
  const monthFolders = listMonthFolders(companyId, monthKey);
  const groups = new Map<string, MonthDocumentGroup>();
  const cashPayments = listCashPaymentsForMonth(companyId, monthKey).map((payment) => ({
    id: payment.id,
    amountLiteral: payment.amountLiteral,
    amountDisplay: formatPaymentAmount(payment.amountLiteral, payment.amountCents),
    receiptAt: payment.receiptAt,
    receiptDisplay: formatReceiptAt(payment.receiptAt),
    blocekFileId: payment.blocekFileId,
    documentName: fileNameById.get(payment.blocekFileId) ?? payment.blocekFileId,
    decodeStatus: payment.decodeStatus,
  }));
  const manualQueue = listManualQueueForMonth(companyId, monthKey)
    .filter((entry) => !cashPayments.some((payment) => payment.blocekFileId === entry.driveFileId))
    .map((entry) => ({
      driveFileId: entry.driveFileId,
      documentName: fileNameById.get(entry.driveFileId) ?? entry.driveFileId,
      reason: entry.reason,
    }));
  const pendingDecodeCount = listPendingDecodeJobsForMonth(companyId, monthKey).length;

  for (const folder of monthFolders) {
    const classification = classifyFolder(folder.name, {
      canonicalFolderNames: settings.canonicalFolderNames,
    });
    const proposedTargetName =
      classification.kind === "repair-candidate"
        ? classification.targetName
        : null;
    const observedName =
      classification.kind === "repair-candidate"
        ? classification.observedName
        : classification.name;
    const title =
      classification.kind === "canonical"
        ? classification.name
        : classification.kind === "repair-candidate"
          ? `${classification.observedName} → repair to ${classification.targetName}`
          : classification.name;
    const activeMutation = getActiveMutationForFolder(folder.driveFolderId);

    groups.set(folder.driveFolderId, {
      driveFolderId: folder.driveFolderId,
      title,
      kind: classification.kind,
      observedName,
      proposedTargetName,
      canRename: folder.canRename,
      renameBlockedReason: renameBlockedReason(folder.canRename),
      activeMutationId: activeMutation?.id ?? null,
      documents: [],
    });
  }

  for (const file of files) {
    if (file.deleted) {
      continue;
    }

    if (file.folderSlot === null) {
      const key = "__vat__";
      const existing = groups.get(key) ?? {
        driveFolderId: key,
        title: "VAT outputs (read-only)",
        kind: "vat-output" as const,
        observedName: "VAT outputs",
        proposedTargetName: null,
        canRename: false,
        renameBlockedReason: null,
        activeMutationId: null,
        documents: [],
      };
      existing.documents.push({
        driveFileId: file.driveFileId,
        name: file.name,
        deleted: file.deleted,
      });
      groups.set(key, existing);
      continue;
    }

    const classification = classifyFolder(file.folderSlot, {
      canonicalFolderNames: settings.canonicalFolderNames,
    });
    const folderId =
      monthFolders.find((folder) => folder.name === file.folderSlot)
        ?.driveFolderId ?? file.parentId;
    const proposedTargetName =
      classification.kind === "repair-candidate"
        ? classification.targetName
        : null;
    const observedName =
      classification.kind === "repair-candidate"
        ? classification.observedName
        : classification.name;
    const title =
      classification.kind === "canonical"
        ? classification.name
        : classification.kind === "repair-candidate"
          ? `${classification.observedName} → repair to ${classification.targetName}`
          : classification.name;
    const kind = classification.kind;
    const activeMutation = getActiveMutationForFolder(folderId);
    const existingFolder = monthFolders.find(
      (folder) => folder.driveFolderId === folderId,
    );
    const existing = groups.get(folderId) ?? {
      driveFolderId: folderId,
      title,
      kind,
      observedName,
      proposedTargetName,
      canRename: existingFolder?.canRename ?? true,
      renameBlockedReason: renameBlockedReason(existingFolder?.canRename ?? true),
      activeMutationId: activeMutation?.id ?? null,
      documents: [],
    };
    existing.documents.push({
      driveFileId: file.driveFileId,
      name: file.name,
      deleted: file.deleted,
    });
    groups.set(folderId, existing);
  }

  return {
    companyName: company.name,
    monthKey,
    canonicalFolderNames: settings.canonicalFolderNames,
    readOnly: month.closedAt !== null,
    isOpenMonth: openMonthKey === monthKey,
    closedAt: month.closedAt,
    cashPayments,
    pendingDecodeCount,
    manualQueue,
    groups: [...groups.values()],
  };
}
