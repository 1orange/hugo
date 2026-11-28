import { getCompanyById, listCompanies } from "@/adapters/store/companies";
import { listCompanyIdsWithoutProfile } from "@/adapters/store/company-profiles";
import { getActiveMutationForFolder } from "@/adapters/store/drive-mutations";
import { listFilesForMonth } from "@/adapters/store/files";
import { listMonthFolders } from "@/adapters/store/month-folders";
import { countStructureDeviationsByCompany } from "@/adapters/store/structure-deviations";
import { listClientRegisterStatuses } from "@/adapters/store/subjects";
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
import { companyDisplayName } from "@/modules/company-display-name";
import { classifyFolder, expectedSlotsFor, observedFolderName } from "@/modules/folder-taxonomy";
import {
  isProcessedFolderSlot,
  STATEMENT_FOLDER_SLOT,
} from "@/modules/document-state";
import {
  deriveChaseState,
  sortChaseRows,
  summariseChaseList,
  type ChaseState,
  type ChaseSummary,
} from "@/modules/chase-list";

import {
  describeMissingSlots,
  deriveCompanyStage,
  isFutureMonth,
  monthKeyAt,
  type CompanyStage,
  type MissingSlot,
} from "@/modules/month-lifecycle";

/** The summariser lives in the pure chase-list module; re-exported for server callers. */
export { summariseChaseList, type ChaseSummary };

export type CompanyListItem = {
  id: number;
  /** Stable across database rebuilds; what Drive sharing and the group chips are keyed by (PRD 0004). */
  driveFolderId: string;
  name: string;
  /** The accountant's folder on the shared drive ("Eva"); null for a company at the root. */
  groupName: string | null;
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
  /**
   * The register's word on the client's company, where it is not in order (0006/03): a
   * dissolved or suspended registration. Null for an active one, an unchecked one, or a
   * company with no profile.
   */
  registerStanding: "dissolved" | "suspended" | null;
  /** Open deviations from the company's Drive structure, from the last sweep. */
  structureDeviations: number;
};

/** Documents a client uploaded into a month that has not started yet. */
export type FutureMonthUpload = { monthKey: string; count: number };

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
async function monthPresence(companyId: number, monthKey: string): Promise<{
  proofsArrived: number;
  statementArrivedAt: string | null;
  lastUploadAt: string | null;
}> {
  let proofsArrived = 0;
  let statementArrivedAt: string | null = null;
  let lastUploadAt: string | null = null;

  for (const file of await listFilesForMonth(companyId, monthKey)) {
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

/** The mark *Firmy* shows: only a registration that is not in order. */
function standingOf(status: string | undefined): "dissolved" | "suspended" | null {
  return status === "dissolved" || status === "suspended" ? status : null;
}

/**
 * One row per company. With no `monthKey` each row reports that company's own
 * open month, which is the daily chase view; pass one and every row reports the
 * same calendar month instead, so a past month can be reviewed the same way.
 */
export async function listCompanySummaries(
  monthKey?: string | null,
  visibleIds?: ReadonlySet<number>,
): Promise<CompanyListItem[]> {
  // A future month is never the one the dashboard reports, even when asked for.
  const currentMonthKey = monthKeyAt(new Date());
  const requested =
    monthKey && !isFutureMonth(monthKey, currentMonthKey) ? monthKey : null;

  // A person's view passes the companies the visibility guard lets them see (ADR 0023);
  // the sweep and other system callers pass nothing and get every company.
  const companiesList = (await listCompanies()).filter(
    (company) => !visibleIds || visibleIds.has(company.id),
  );
  const missingProfiles = await listCompanyIdsWithoutProfile(companiesList.map((c) => c.id));
  const registerStatuses = await listClientRegisterStatuses(companiesList.map((c) => c.id));
  const deviationCounts = await countStructureDeviationsByCompany();

  const rows = await Promise.all(companiesList.map(async (company) => {
    const openMonth = await getOpenMonthKey(company.id);
    const viewMonth = requested ?? openMonth;
    const month = viewMonth ? await getMonthByKey(company.id, viewMonth) : null;
    // A month key she picked may simply not exist for this client.
    const resolvedMonth = month ? viewMonth : null;

    const awaitingCount =
      resolvedMonth === null
        ? null
        : await countAwaitingDecision(company.id, resolvedMonth);
    const stageView = deriveCompanyStage({
      openMonthKey: openMonth,
      awaitingCount,
      hasDocuments: await companyHasDocuments(company.id),
    });
    const presence =
      resolvedMonth === null
        ? { proofsArrived: 0, statementArrivedAt: null, lastUploadAt: null }
        : await monthPresence(company.id, resolvedMonth);

    return {
      id: company.id,
      driveFolderId: company.driveFolderId,
      name: companyDisplayName(company.name),
      groupName: company.groupName ?? null,
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
        archived: company.archived,
      }),
      profileMissing: missingProfiles.has(company.id),
      registerStanding: standingOf(registerStatuses.get(company.id)),
      structureDeviations: deviationCounts.get(company.id) ?? 0,
    };
  }));

  return sortChaseRows(rows);
}

/**
 * Every month key any company has that has started, newest first. Drives the
 * month picker on the chase list. Pre-created future months are left out.
 */
export async function listAllMonthKeys(visibleIds?: ReadonlySet<number>): Promise<string[]> {
  const currentMonthKey = monthKeyAt(new Date());
  const keys = new Set<string>();
  for (const company of await listCompanies()) {
    if (visibleIds && !visibleIds.has(company.id)) {
      continue;
    }
    for (const month of await listMonthsForCompany(company.id)) {
      if (!isFutureMonth(month.monthKey, currentMonthKey)) {
        keys.add(month.monthKey);
      }
    }
  }
  return [...keys].sort((left, right) => right.localeCompare(left));
}

function renameBlockedReason(canRename: boolean): string | null {
  if (!canRename) {
    return "Drive reports this folder cannot be renamed. It may be owned by the client or shared with restricted permissions.";
  }
  return null;
}

/** Non-deleted files in months after the current one, by month. */
async function listFutureMonthUploads(
  companyId: number,
  currentMonthKey: string,
): Promise<FutureMonthUpload[]> {
  const uploads: FutureMonthUpload[] = [];
  for (const month of await listMonthsForCompany(companyId)) {
    if (!isFutureMonth(month.monthKey, currentMonthKey)) {
      continue;
    }
    const count = (await listFilesForMonth(companyId, month.monthKey)).filter(
      (file) => !file.deleted,
    ).length;
    if (count > 0) {
      uploads.push({ monthKey: month.monthKey, count });
    }
  }
  return uploads;
}

export async function buildMonthView(
  companyId: number,
  monthKey: string,
): Promise<{
  companyName: string;
  monthKey: string;
  canonicalFolderNames: string[];
  readOnly: boolean;
  isOpenMonth: boolean;
  closedAt: string | null;
  missingSlots: MissingSlot[];
  futureUploads: FutureMonthUpload[];
  groups: MonthDocumentGroup[];
} | null> {
  const company = await getCompanyById(companyId);
  if (!company) {
    return null;
  }

  const month = await getMonthByKey(companyId, monthKey);
  if (!month) {
    return null;
  }

  const [openMonthKey, settings, files, monthFolders] = await Promise.all([
    getOpenMonthKey(companyId),
    getSettings(),
    listFilesForMonth(companyId, monthKey),
    listMonthFolders(companyId, monthKey),
  ]);
  const groups = new Map<string, MonthDocumentGroup>();

  for (const folder of monthFolders) {
    const classification = classifyFolder(
      folder.name,
      { canonicalFolderNames: settings.canonicalFolderNames },
      monthKey,
    );
    const proposedTargetName =
      classification.kind === "repair-candidate"
        ? classification.targetName
        : null;
    const observedName = observedFolderName(classification);
    const title =
      classification.kind === "canonical"
        ? classification.name
        : classification.kind === "repair-candidate"
          ? `${classification.observedName} → repair to ${classification.targetName}`
          : classification.name;
    const activeMutation = await getActiveMutationForFolder(folder.driveFolderId);

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
    const observedName = observedFolderName(classification);
    const title =
      classification.kind === "canonical"
        ? classification.name
        : classification.kind === "repair-candidate"
          ? `${classification.observedName} → repair to ${classification.targetName}`
          : classification.name;
    const kind = classification.kind;
    const activeMutation = await getActiveMutationForFolder(folderId);
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

  const isOpenMonth = openMonthKey === monthKey;

  return {
    companyName: companyDisplayName(company.name),
    monthKey,
    canonicalFolderNames: settings.canonicalFolderNames,
    readOnly: month.closedAt !== null,
    isOpenMonth,
    closedAt: month.closedAt,
    // Early uploads are noted on the open month only; they are never moved.
    futureUploads: isOpenMonth
      ? await listFutureMonthUploads(companyId, monthKeyAt(new Date()))
      : [],
    missingSlots: describeMissingSlots(
      monthFolders.map((folder) => ({
        name: folder.name,
        classification: classifyFolder(
          folder.name,
          { canonicalFolderNames: settings.canonicalFolderNames },
          monthKey,
        ),
      })),
      // An older month is not expected to hold the types it never had (travel orders, VAT).
      expectedSlotsFor(monthKey, settings.canonicalFolderNames),
    ),
    groups: [...groups.values()],
  };
}
