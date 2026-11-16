import type { DriveCapabilities } from "@/modules/drive-mutation";
import type { DriveChangeEntry } from "@/modules/drive-changes";
import type { DriveFileRecord } from "@/modules/drive-tree";

export type { DriveCapabilities, DriveFileRecord };

export interface DriveClient {
  list(): Promise<DriveFileRecord[]>;
  download(fileId: string): Promise<Uint8Array>;
  rename(fileId: string, newName: string): Promise<void>;
  /** Moves a file from one folder to another; its ID, links and permissions stay (ADR 0006). */
  move(fileId: string, fromParentId: string, toParentId: string): Promise<void>;
}

/**
 * Push notifications for changes anywhere in the Drive the service account
 * sees (ADR 0020). A notification carries no payload: it only says to sweep.
 */
export interface DriveChangesWatch {
  watchChanges(input: {
    channelId: string;
    token: string;
    address: string;
    expiresAt: Date;
  }): Promise<{ resourceId: string; expiresAt: string }>;
  stopChannel(input: { channelId: string; resourceId: string }): Promise<void>;
}

export function canWatchChanges(client: DriveClient): client is DriveClient & DriveChangesWatch {
  const candidate = client as Partial<DriveChangesWatch>;
  return typeof candidate.watchChanges === "function" && typeof candidate.stopChannel === "function";
}

/** One entry of Drive's change log: a file added, changed, trashed, or gone (deleted or access lost). */
export type DriveChange = DriveChangeEntry;

/**
 * Drive's change log, so a sweep reads what changed since the last one instead
 * of listing every file (ADR 0003, amended 2026-11-12): ~0.4 s, not ~70 s.
 */
export interface DriveChangesFeed {
  /** The log's current position; taken before a full listing, so nothing made during it is missed. */
  startPageToken(): Promise<string>;
  /** Every change since `token`, all pages; null when Drive no longer accepts the token. */
  changesSince(token: string): Promise<{ changes: DriveChange[]; newStartPageToken: string } | null>;
}

export function hasChangesFeed(client: DriveClient): client is DriveClient & DriveChangesFeed {
  const candidate = client as Partial<DriveChangesFeed>;
  return typeof candidate.startPageToken === "function" && typeof candidate.changesSince === "function";
}
