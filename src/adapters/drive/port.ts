import type { DriveCapabilities } from "@/modules/drive-mutation";
import type { DriveFileRecord } from "@/modules/drive-tree";

export type { DriveCapabilities, DriveFileRecord };

export interface DriveClient {
  list(): Promise<DriveFileRecord[]>;
  download(fileId: string): Promise<Uint8Array>;
  rename(fileId: string, newName: string): Promise<void>;
  createFolder(name: string, parentId: string): Promise<string>;
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
