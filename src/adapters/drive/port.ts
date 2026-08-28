import type { DriveCapabilities } from "@/modules/drive-mutation";
import type { DriveFileRecord } from "@/modules/drive-tree";

export type { DriveCapabilities, DriveFileRecord };

export interface DriveClient {
  list(): Promise<DriveFileRecord[]>;
  download(fileId: string): Promise<Uint8Array>;
  rename(fileId: string, newName: string): Promise<void>;
  createFolder(name: string, parentId: string): Promise<string>;
}
