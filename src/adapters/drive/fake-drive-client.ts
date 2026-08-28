import type { DriveFileRecord } from "@/modules/drive-tree";
import type { DriveClient } from "./port";

export class FakeDriveClient implements DriveClient {
  constructor(private readonly files: DriveFileRecord[]) {}

  async list(): Promise<DriveFileRecord[]> {
    return this.files.map((file) => ({
      ...file,
      parents: [...file.parents],
    }));
  }
}
