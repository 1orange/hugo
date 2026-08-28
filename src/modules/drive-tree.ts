import {
  classifyFolder,
  parseMonthFolder,
  type FolderClassification,
  type FolderTaxonomySettings,
} from "./folder-taxonomy";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFileRecord = {
  id: string;
  name: string;
  parents: string[];
  createdTime: string;
  mimeType: string;
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
  deleted: boolean;
};

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
  classification: FolderClassification;
  documents: TreeDocument[];
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
  months: TreeMonth[];
};

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
  driveParentFolderId: string,
  settings: FolderTaxonomySettings,
): FileLocation | null {
  const start = byId.get(fileId);
  if (!start || !start.parentId) {
    return null;
  }

  let currentId = start.parentId;
  let folderSlot: string | null = null;
  let monthKey: string | null = null;
  let companyDriveFolderId: string | null = null;

  while (currentId) {
    const node = byId.get(currentId);
    if (!node) {
      return null;
    }

    if (parseMonthFolder(node.name)) {
      monthKey = parseMonthFolder(node.name)!.key;
      const parentId = node.parentId;
      if (!parentId) {
        return null;
      }
      const companyNode = byId.get(parentId);
      if (!companyNode || companyNode.parentId !== driveParentFolderId) {
        return null;
      }
      companyDriveFolderId = companyNode.id;
      return {
        companyDriveFolderId,
        monthKey,
        folderSlot,
        parentId: start.parentId,
      };
    }

    if (isFolder(node)) {
      const classification = classifyFolder(node.name, settings);
      if (
        classification.kind === "canonical" ||
        classification.kind === "repair-candidate"
      ) {
        folderSlot =
          classification.kind === "canonical"
            ? classification.name
            : classification.observedName;
      }
    }

    if (!node.parentId) {
      return null;
    }
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
  const companies: TreeCompany[] = [];

  for (const record of files) {
    if (!isFolder(record)) {
      continue;
    }
    if (record.parents[0] !== driveParentFolderId) {
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

        const classification = classifyFolder(candidate.name, settings);
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

        folderSlots.set(candidate.id, { classification, documents });
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
      months,
    });
  }

  companies.sort((left, right) => left.name.localeCompare(right.name));
  return companies;
}

export function buildDriveTree(input: DriveTreeInput): DriveTreeResult {
  const byId = indexFiles(input.files);
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
    const location = resolveLocation(
      record.id,
      byId,
      input.driveParentFolderId,
      input.settings,
    );
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

    if (wasDeleted) {
      existing.companyDriveFolderId = location.companyDriveFolderId;
      existing.monthKey = location.monthKey;
      existing.folderSlot = location.folderSlot;
      existing.parentId = location.parentId;
      existing.name = record.name;
      existing.firstSeenAt = input.sweepAt;
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
    events.push({
      type: "FileDeleted",
      driveFileId: stored.driveFileId,
    });
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
