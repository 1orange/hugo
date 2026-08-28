import type { DriveCapabilities } from "@/modules/drive-mutation";
import type { DriveFileRecord } from "@/modules/drive-tree";

export type { DriveCapabilities, DriveFileRecord };

export interface DriveClient {
  list(): Promise<DriveFileRecord[]>;
  rename(fileId: string, newName: string): Promise<void>;
}
