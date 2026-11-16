import {
  classifyFolder,
  parseMonthFolder,
  type FolderClassification,
  type FolderTaxonomySettings,
} from "./folder-taxonomy";
import type { DriveCapabilities } from "./drive-mutation";
import { isSystemFile } from "./system-files";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFileRecord = {
  id: string;
  name: string;
  parents: string[];
  createdTime: string;
  mimeType: string;
  capabilities?: DriveCapabilities;
};

export type StoredFileState = {
  driveFileId: string;
  companyDriveFolderId: string;
  monthKey: string;
  folderSlot: string | null;
  parentId: string;
  name: string;
  mimeType: string;
  driveCreatedTime: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /**
   * When it was moved into the month it is in from another month; null (or
   * absent) when it has been there since it was first seen (ADR 0005, amended 2026-11-12).
   */
  arrivedAt?: string | null;
  /** Drive's `canMoveItemWithinDrive`; absent means it may be moved (ADR 0006). */
  canMove?: boolean;
  deleted: boolean;
};

/**
 * A stored file's state, for telling whether a sweep changed it. `lastSeenAt`
 * is left out: it moves on every sweep and nothing reads it.
 */
export function fileStateKey(file: StoredFileState): string {
  return JSON.stringify([
    file.companyDriveFolderId,
    file.monthKey,
    file.folderSlot,
    file.parentId,
    file.name,
    file.mimeType,
    file.driveCreatedTime,
    file.firstSeenAt,
    file.arrivedAt ?? null,
    file.canMove ?? true,
    file.deleted,
  ]);
}

export type DomainEvent =
  | {
      type: "FileDiscovered";
      driveFileId: string;
      companyDriveFolderId: string;
      monthKey: string;
      folderSlot: string | null;
      name: string;
      mimeType: string;
      driveCreatedTime: string;
      firstSeenAt: string;
    }
  | {
      type: "FileRenamedInDrive";
      driveFileId: string;
      previousName: string;
      newName: string;
    }
  | {
      type: "FileMovedByClient";
      driveFileId: string;
      previousParentId: string;
      newParentId: string;
      companyDriveFolderId: string;
      monthKey: string;
      folderSlot: string | null;
    }
  | {
      type: "FileDeleted";
      driveFileId: string;
    };

export type TreeDocument = {
  driveFileId: string;
  name: string;
  mimeType: string;
  driveCreatedTime: string;
  firstSeenAt: string;
  deleted: boolean;
};

export type TreeFolderSlot = {
  driveFolderId: string;
  classification: FolderClassification;
  documents: TreeDocument[];
  capabilities?: DriveCapabilities;
};

export type TreeMonth = {
  key: string;
  driveFolderId: string;
  folderSlots: TreeFolderSlot[];
  monthRootOutputs: TreeDocument[];
};

export type TreeCompany = {
  driveFolderId: string;
  name: string;
  /** The accountant's folder it sits in ("Eva"), or null for a company at the root. */
  groupName: string | null;
  /** In the archive: a client that gets no new months. */
  archived: boolean;
  months: TreeMonth[];
};

/** A company's group: the accountant's folder at the root, or the archive. */
export type CompanyGroup = { name: string; archived: boolean };

/**
 * The group a root folder stands for (the office's rules, 2026-11-11): the name
 * is the part before " – " ("Katarína – doklady klientov" → "Katarína"), the
 * whole name when there is none; the archive is the one whose name says so.
 */
export function companyGroupOf(folderName: string): CompanyGroup {
  const name = folderName.normalize("NFC").trim();
  const label = name.split(/\s+[–—-]\s+/u)[0]!.trim() || name;
  const folded = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return { name: label, archived: folded.includes("archiv") };
}

/**
 * The folders company folders sit in. Read by depth, not by name (the office's
 * rules): every folder at the root is an accountant (or the archive), and every
 * folder in one is a client. A root folder that holds month folders itself is a
 * company, as in the flat layouts before 2026-11-11; the root is then its parent.
 */
function companyParents(
  byId: Map<string, IndexedRecord>,
  driveParentFolderId: string,
): Map<string, CompanyGroup | null> {
  const holdsMonths = new Set<string>();
  for (const record of byId.values()) {
    if (isFolder(record) && record.parentId && parseMonthFolder(record.name)) {
      holdsMonths.add(record.parentId);
    }
  }
  const parents = new Map<string, CompanyGroup | null>([[driveParentFolderId, null]]);
  for (const record of byId.values()) {
    if (record.parentId !== driveParentFolderId || !isFolder(record) || holdsMonths.has(record.id)) {
      continue;
    }
    parents.set(record.id, companyGroupOf(record.name));
  }
  return parents;
}

/** Whether a folder is a company: in the root or in a group folder, and not a group folder itself. */
function isCompanyFolder(
  record: IndexedRecord,
  parents: Map<string, CompanyGroup | null>,
): boolean {
  return isFolder(record) && record.parentId !== null && parents.has(record.parentId) && !parents.has(record.id);
}

export type DriveTreeInput = {
  files: DriveFileRecord[];
  driveParentFolderId: string;
  storedFiles: StoredFileState[];
  sweepAt: string;
  settings: FolderTaxonomySettings;
};

export type DriveTreeResult = {
  tree: TreeCompany[];
  events: DomainEvent[];
  updatedFiles: StoredFileState[];
};

type IndexedRecord = DriveFileRecord & { parentId: string | null };

type FileLocation = {
  companyDriveFolderId: string;
  monthKey: string;
  folderSlot: string | null;
  parentId: string;
};

function isFolder(record: DriveFileRecord): boolean {
  return record.mimeType === FOLDER_MIME;
}

function indexFiles(files: DriveFileRecord[]): Map<string, IndexedRecord> {
  const byId = new Map<string, IndexedRecord>();
  for (const file of files) {
    byId.set(file.id, {
      ...file,
      parentId: file.parents[0] ?? null,
    });
  }
  return byId;
}

function resolveLocation(
  fileId: string,
  byId: Map<string, IndexedRecord>,
  parents: Map<string, CompanyGroup | null>,
  settings: FolderTaxonomySettings,
): FileLocation | null {
  const start = byId.get(fileId);
  if (!start || !start.parentId) {
    return null;
  }

  // Up to the month folder; the folder just below it is the document type.
  let currentId: string | null = start.parentId;
  let belowMonth: IndexedRecord | null = null;

  while (currentId) {
    const node = byId.get(currentId);
    if (!node) {
      return null;
    }

    const month = parseMonthFolder(node.name);
    if (month && isFolder(node)) {
      const companyNode = node.parentId ? byId.get(node.parentId) : undefined;
      if (!companyNode || !isCompanyFolder(companyNode, parents)) {
        return null;
      }
      let folderSlot: string | null = null;
      if (belowMonth) {
        const classification = classifyFolder(belowMonth.name, settings, month.key);
        if (classification.kind === "canonical") {
          folderSlot = classification.name;
        } else if (classification.kind === "repair-candidate") {
          folderSlot = classification.observedName;
        }
      }
      return {
        companyDriveFolderId: companyNode.id,
        monthKey: month.key,
        folderSlot,
        parentId: start.parentId,
      };
    }

    belowMonth = node;
    currentId = node.parentId;
  }

  return null;
}

function storedLocationKey(file: StoredFileState): string {
  return [
    file.companyDriveFolderId,
    file.monthKey,
    file.folderSlot ?? "",
  ].join("|");
}

function locationKey(location: FileLocation): string {
  return [
    location.companyDriveFolderId,
    location.monthKey,
    location.folderSlot ?? "",
  ].join("|");
}

function buildTree(
  files: DriveFileRecord[],
  driveParentFolderId: string,
  storedById: Map<string, StoredFileState>,
  settings: FolderTaxonomySettings,
): TreeCompany[] {
  const byId = indexFiles(files);
  const parents = companyParents(byId, driveParentFolderId);
  const companies: TreeCompany[] = [];

  for (const record of files) {
    const indexed = byId.get(record.id)!;
    if (!isCompanyFolder(indexed, parents)) {
      continue;
    }

    const months: TreeMonth[] = [];
    for (const child of files) {
      if (!isFolder(child) || child.parents[0] !== record.id) {
        continue;
      }
      const monthFolder = parseMonthFolder(child.name);
      if (!monthFolder) {
        continue;
      }

      const folderSlots = new Map<string, TreeFolderSlot>();
      const monthRootOutputs: TreeDocument[] = [];

      for (const candidate of files) {
        if (!isFolder(candidate) || candidate.parents[0] !== child.id) {
          continue;
        }

        const classification = classifyFolder(candidate.name, settings, monthFolder.key);
        const documents: TreeDocument[] = [];
        for (const doc of files) {
          if (isFolder(doc) || doc.parents[0] !== candidate.id) {
            continue;
          }
          const stored = storedById.get(doc.id);
          documents.push({
            driveFileId: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
            driveCreatedTime: doc.createdTime,
            firstSeenAt: stored?.firstSeenAt ?? "",
            deleted: stored?.deleted ?? false,
          });
        }

        folderSlots.set(candidate.id, {
          driveFolderId: candidate.id,
          classification,
          documents,
          capabilities: candidate.capabilities,
        });
      }

      for (const doc of files) {
        if (isFolder(doc) || doc.parents[0] !== child.id) {
          continue;
        }
        const stored = storedById.get(doc.id);
        monthRootOutputs.push({
          driveFileId: doc.id,
          name: doc.name,
          mimeType: doc.mimeType,
          driveCreatedTime: doc.createdTime,
          firstSeenAt: stored?.firstSeenAt ?? "",
          deleted: stored?.deleted ?? false,
        });
      }

      months.push({
        key: monthFolder.key,
        driveFolderId: child.id,
        folderSlots: [...folderSlots.values()],
        monthRootOutputs,
      });
    }

    months.sort((left, right) => left.key.localeCompare(right.key));
    companies.push({
      driveFolderId: record.id,
      name: record.name,
      groupName: parents.get(indexed.parentId!)?.name ?? null,
      archived: parents.get(indexed.parentId!)?.archived ?? false,
      months,
    });
  }

  companies.sort((left, right) => left.name.localeCompare(right.name));
  return companies;
}

/**
 * Drive names arrive in whichever Unicode normalisation the uploader's system
 * used — the real sample folders are all NFD, where a name that looks identical
 * to its canonical form is not equal to it. Normalising here, at the single
 * point every Drive record enters the app, keeps every downstream comparison
 * and stored name in one form.
 */
function normalizeRecordName(record: DriveFileRecord): DriveFileRecord {
  const name = record.name.normalize("NFC");
  return name === record.name ? record : { ...record, name };
}

export function buildDriveTree(input: DriveTreeInput): DriveTreeResult {
  // desktop.ini and its kind never enter the app (system-files module).
  input = {
    ...input,
    files: input.files
      .map(normalizeRecordName)
      .filter((record) => isFolder(record) || !isSystemFile(record.name)),
  };
  const byId = indexFiles(input.files);
  const parents = companyParents(byId, input.driveParentFolderId);
  const storedById = new Map(
    input.storedFiles.map((file) => [file.driveFileId, { ...file }]),
  );
  const events: DomainEvent[] = [];
  const seenIds = new Set<string>();

  for (const record of input.files) {
    if (isFolder(record)) {
      continue;
    }

    seenIds.add(record.id);
    const location = resolveLocation(record.id, byId, parents, input.settings);
    if (!location) {
      continue;
    }

    const existing = storedById.get(record.id);
    if (!existing) {
      const discovered: StoredFileState = {
        driveFileId: record.id,
        companyDriveFolderId: location.companyDriveFolderId,
        monthKey: location.monthKey,
        folderSlot: location.folderSlot,
        parentId: location.parentId,
        name: record.name,
        mimeType: record.mimeType,
        driveCreatedTime: record.createdTime,
        firstSeenAt: input.sweepAt,
        lastSeenAt: input.sweepAt,
        arrivedAt: null,
        canMove: record.capabilities?.canMoveItemWithinDrive !== false,
        deleted: false,
      };
      storedById.set(record.id, discovered);
      events.push({
        type: "FileDiscovered",
        driveFileId: record.id,
        companyDriveFolderId: location.companyDriveFolderId,
        monthKey: location.monthKey,
        folderSlot: location.folderSlot,
        name: record.name,
        mimeType: record.mimeType,
        driveCreatedTime: record.createdTime,
        firstSeenAt: input.sweepAt,
      });
      continue;
    }

    const wasDeleted = existing.deleted;
    existing.deleted = false;
    existing.lastSeenAt = input.sweepAt;
    existing.driveCreatedTime = record.createdTime;
    existing.mimeType = record.mimeType;
    existing.canMove = record.capabilities?.canMoveItemWithinDrive !== false;

    if (wasDeleted) {
      existing.companyDriveFolderId = location.companyDriveFolderId;
      existing.monthKey = location.monthKey;
      existing.folderSlot = location.folderSlot;
      existing.parentId = location.parentId;
      existing.name = record.name;
      existing.firstSeenAt = input.sweepAt;
      existing.arrivedAt = null;
      events.push({
        type: "FileDiscovered",
        driveFileId: record.id,
        companyDriveFolderId: location.companyDriveFolderId,
        monthKey: location.monthKey,
        folderSlot: location.folderSlot,
        name: record.name,
        mimeType: record.mimeType,
        driveCreatedTime: record.createdTime,
        firstSeenAt: input.sweepAt,
      });
      continue;
    }

    const locationChanged =
      storedLocationKey(existing) !== locationKey(location);
    const nameChanged = existing.name !== record.name;

    if (locationChanged) {
      events.push({
        type: "FileMovedByClient",
        driveFileId: record.id,
        previousParentId: existing.parentId,
        newParentId: location.parentId,
        companyDriveFolderId: location.companyDriveFolderId,
        monthKey: location.monthKey,
        folderSlot: location.folderSlot,
      });
      // Into another month it arrives anew; a move between folders of one month does not.
      if (
        existing.companyDriveFolderId !== location.companyDriveFolderId ||
        existing.monthKey !== location.monthKey
      ) {
        existing.arrivedAt = input.sweepAt;
      }
      existing.companyDriveFolderId = location.companyDriveFolderId;
      existing.monthKey = location.monthKey;
      existing.folderSlot = location.folderSlot;
      existing.parentId = location.parentId;
      existing.name = record.name;
    } else if (nameChanged) {
      events.push({
        type: "FileRenamedInDrive",
        driveFileId: record.id,
        previousName: existing.name,
        newName: record.name,
      });
      existing.name = record.name;
    }
  }

  for (const stored of storedById.values()) {
    if (stored.deleted || seenIds.has(stored.driveFileId)) {
      continue;
    }
    stored.deleted = true;
    // One stored before system files were left out goes without a word: it
    // was never a document, and saying it was deleted would only be noise.
    if (!isSystemFile(stored.name)) {
      events.push({
        type: "FileDeleted",
        driveFileId: stored.driveFileId,
      });
    }
  }

  const tree = buildTree(
    input.files,
    input.driveParentFolderId,
    storedById,
    input.settings,
  );

  return {
    tree,
    events,
    updatedFiles: [...storedById.values()],
  };
}
