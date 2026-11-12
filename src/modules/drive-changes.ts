import type { DriveFileRecord } from "./drive-tree";

export type DriveChangeEntry = {
  fileId: string;
  removed: boolean;
  file: (DriveFileRecord & { trashed: boolean }) | null;
};

/** A full listing at least this often, in case a change was ever missed. */
export const FULL_LISTING_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Drive's change log as snapshot writes: a file trashed or gone is removed,
 * anything else is written as it is now. The log may name a file twice; the
 * last entry is its current state.
 */
export function snapshotWritesFor(changes: DriveChangeEntry[]): { upserts: DriveFileRecord[]; removedIds: string[] } {
  const latest = new Map<string, DriveChangeEntry>();
  for (const change of changes) {
    latest.delete(change.fileId);
    latest.set(change.fileId, change);
  }
  const upserts: DriveFileRecord[] = [];
  const removedIds: string[] = [];
  for (const change of latest.values()) {
    if (change.removed || !change.file || change.file.trashed) {
      removedIds.push(change.fileId);
      continue;
    }
    const { trashed: _trashed, ...file } = change.file;
    upserts.push(file);
  }
  return { upserts, removedIds };
}

/** Whether the sweep may read the change log, or must list every file. */
export function needsFullListing(
  state: { changesToken: string | null; snapshotAt: string | null },
  nowMs: number,
): boolean {
  if (!state.changesToken || !state.snapshotAt) {
    return true;
  }
  const listedAt = Date.parse(state.snapshotAt);
  return Number.isNaN(listedAt) || nowMs - listedAt >= FULL_LISTING_AFTER_MS;
}
