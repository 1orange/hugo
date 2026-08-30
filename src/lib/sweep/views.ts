import { getCompanyById, listCompanies } from "@/adapters/store/companies";
import { getActiveMutationForFolder } from "@/adapters/store/drive-mutations";
import { listFilesForMonth } from "@/adapters/store/files";
import { listMonthFolders } from "@/adapters/store/month-folders";
import {
  countAwaitingDecision,
  companyHasDocuments,
} from "@/adapters/store/documents";
import {
  getMonthByKey,
  getOpenMonthKey,
} from "@/adapters/store/months";
import { getSettings } from "@/adapters/store/settings";
import { classifyFolder } from "@/modules/folder-taxonomy";
import {
  describeMissingSlots,
  deriveCompanyStage,
  type CompanyStage,
  type MissingSlot,
} from "@/modules/month-lifecycle";

export type CompanyListItem = {
  id: number;
  name: string;
  openMonth: string | null;
  stage: CompanyStage;
  awaitingCount: number | null;
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
    const awaitingCount =
      openMonth === null ? null : countAwaitingDecision(company.id, openMonth);
    const stageView = deriveCompanyStage({
      openMonthKey: openMonth,
      awaitingCount,
      hasDocuments: companyHasDocuments(company.id),
    });
    return {
      id: company.id,
      name: company.name,
      openMonth,
      stage: stageView.stage,
      awaitingCount: stageView.awaitingCount,
    };
  });
}

function renameBlockedReason(canRename: boolean): string | null {
  if (!canRename) {
    return "Drive reports this folder cannot be renamed. It may be owned by the client or shared with restricted permissions.";
  }
  return null;
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
  missingSlots: MissingSlot[];
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
  const monthFolders = listMonthFolders(companyId, monthKey);
  const groups = new Map<string, MonthDocumentGroup>();

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
    missingSlots: describeMissingSlots(
      monthFolders.map((folder) => ({
        name: folder.name,
        classification: classifyFolder(folder.name, {
          canonicalFolderNames: settings.canonicalFolderNames,
        }),
      })),
      settings.canonicalFolderNames,
    ),
    groups: [...groups.values()],
  };
}
