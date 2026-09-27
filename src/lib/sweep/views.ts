import { getCompanyById, listCompanies } from "@/adapters/store/companies";
import { listCompanyIdsWithoutProfile } from "@/adapters/store/company-profiles";
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
  listMonthsForCompany,
} from "@/adapters/store/months";
import { getSettings } from "@/adapters/store/settings";
import { classifyFolder } from "@/modules/folder-taxonomy";
import {
  isProcessedFolderSlot,
  STATEMENT_FOLDER_SLOT,
} from "@/modules/document-state";
import {
  deriveChaseState,
  sortChaseRows,
  type ChaseState,
} from "@/modules/chase-list";
import {
  describeMissingSlots,
  deriveCompanyStage,
  type CompanyStage,
  type MissingSlot,
} from "@/modules/month-lifecycle";

export type CompanyListItem = {
  id: number;
  name: string;
  /** The month this row is reporting on. */
  monthKey: string | null;
  monthClosed: boolean;
  /** The company's own open month, whichever month the row is showing. */
  openMonth: string | null;
  stage: CompanyStage;
  awaitingCount: number | null;
  /** Files in the processed folders `01`, `02`, `04`, `05`, `06`. */
  proofsArrived: number;
  /** When the newest file in `03` was created in Drive; null means none yet. */
  statementArrivedAt: string | null;
  /** Newest arrival anywhere in the month, `03` included. */
  lastUploadAt: string | null;
  chaseState: ChaseState;
  profileMissing: boolean;
};

export type ChaseSummary = {
  awaitingTotal: number;
  withoutStatement: number;
  silent: number;
  readyToClose: number;
  withoutProfile: number;
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

/**
 * Presence figures for one company-month, read straight off `files`. No
 * denormalised counters: at 5–15 companies and low hundreds of documents a
 * month the aggregate is trivial, and a cached count that drifts is worse than
 * no count (slice 21, ADR 0004).
 */
function monthPresence(companyId: number, monthKey: string): {
  proofsArrived: number;
  statementArrivedAt: string | null;
  lastUploadAt: string | null;
} {
  let proofsArrived = 0;
  let statementArrivedAt: string | null = null;
  let lastUploadAt: string | null = null;

  for (const file of listFilesForMonth(companyId, monthKey)) {
    if (file.deleted) {
      continue;
    }

    // Drive's created time, not our first-seen time: she wants to know when the
    // client uploaded, not when the sweep happened to notice.
    const arrivedAt = file.driveCreatedTime;
    if (lastUploadAt === null || arrivedAt > lastUploadAt) {
      lastUploadAt = arrivedAt;
    }

    if (isProcessedFolderSlot(file.folderSlot)) {
      proofsArrived += 1;
      continue;
    }

    if (file.folderSlot === STATEMENT_FOLDER_SLOT) {
      if (statementArrivedAt === null || arrivedAt > statementArrivedAt) {
        statementArrivedAt = arrivedAt;
      }
    }
  }

  return { proofsArrived, statementArrivedAt, lastUploadAt };
}

/**
 * One row per company. With no `monthKey` each row reports that company's own
 * open month, which is the daily chase view; pass one and every row reports the
 * same calendar month instead, so a past month can be reviewed the same way.
 */
export function listCompanySummaries(
  monthKey?: string | null,
): CompanyListItem[] {
  const requested = monthKey ?? null;

  const companiesList = listCompanies();
  const missingProfiles = listCompanyIdsWithoutProfile(companiesList.map((c) => c.id));

  const rows = companiesList.map((company) => {
    const openMonth = getOpenMonthKey(company.id);
    const viewMonth = requested ?? openMonth;
    const month = viewMonth ? getMonthByKey(company.id, viewMonth) : null;
    // A month key she picked may simply not exist for this client.
    const resolvedMonth = month ? viewMonth : null;

    const awaitingCount =
      resolvedMonth === null
        ? null
        : countAwaitingDecision(company.id, resolvedMonth);
    const stageView = deriveCompanyStage({
      openMonthKey: openMonth,
      awaitingCount,
      hasDocuments: companyHasDocuments(company.id),
    });
    const presence =
      resolvedMonth === null
        ? { proofsArrived: 0, statementArrivedAt: null, lastUploadAt: null }
        : monthPresence(company.id, resolvedMonth);

    return {
      id: company.id,
      name: company.name,
      monthKey: resolvedMonth,
      monthClosed: month?.closedAt !== null && month?.closedAt !== undefined,
      openMonth,
      stage: stageView.stage,
      awaitingCount:
        resolvedMonth === openMonth ? stageView.awaitingCount : awaitingCount,
      ...presence,
      chaseState: deriveChaseState({
        monthKey: resolvedMonth,
        monthRequested: requested !== null,
        monthClosed: month?.closedAt != null,
        awaitingCount,
        ...presence,
      }),
      profileMissing: missingProfiles.has(company.id),
    };
  });

  return sortChaseRows(rows);
}

/**
 * Every month key any company has, newest first. Drives the month picker on the
 * chase list — she can only look at months that exist somewhere in Drive.
 */
export function listAllMonthKeys(): string[] {
  const keys = new Set<string>();
  for (const company of listCompanies()) {
    for (const month of listMonthsForCompany(company.id)) {
      keys.add(month.monthKey);
    }
  }
  return [...keys].sort((left, right) => right.localeCompare(left));
}

export function summariseChaseList(
  companies: readonly CompanyListItem[],
): ChaseSummary {
  return {
    awaitingTotal: companies.reduce(
      (total, company) => total + (company.awaitingCount ?? 0),
      0,
    ),
    withoutStatement: companies.filter(
      (company) =>
        company.monthKey !== null &&
        !company.monthClosed &&
        company.statementArrivedAt === null,
    ).length,
    silent: companies.filter((company) => company.chaseState === "silent").length,
    readyToClose: companies.filter(
      (company) => company.chaseState === "ready-to-close",
    ).length,
    withoutProfile: companies.filter((company) => company.profileMissing).length,
  };
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
