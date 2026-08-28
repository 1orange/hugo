import type { DriveFileRecord } from "@/modules/drive-tree";
import type { DriveClient } from "./port";

export class FakeDriveClient implements DriveClient {
  constructor(private readonly files: DriveFileRecord[]) {}

  async list(): Promise<DriveFileRecord[]> {
    return this.files.map((file) => ({
      ...file,
      parents: [...file.parents],
      capabilities: file.capabilities
        ? { ...file.capabilities }
        : undefined,
    }));
  }

  async rename(fileId: string, newName: string): Promise<void> {
    const file = this.files.find((entry) => entry.id === fileId);
    if (!file) {
      throw new Error(`Drive file not found: ${fileId}`);
    }
    if (file.capabilities?.canRename === false) {
      throw new Error("Drive refused rename: canRename is false");
    }
    file.name = newName;
  }
}
