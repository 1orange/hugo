import type { DriveFileRecord } from "@/modules/drive-tree";

export type { DriveFileRecord };

export interface DriveClient {
  list(): Promise<DriveFileRecord[]>;
}
