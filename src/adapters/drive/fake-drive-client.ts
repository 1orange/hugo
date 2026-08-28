import { FOLDER_MIME, type DriveFileRecord } from "@/modules/drive-tree";
import type { DriveClient } from "./port";

let fakeIdCounter = 0;

export class FakeDriveClient implements DriveClient {
  constructor(
    private readonly files: DriveFileRecord[],
    private readonly fileContents: Record<string, Uint8Array> = {},
  ) {}

  async list(): Promise<DriveFileRecord[]> {
    return this.files.map((file) => ({
      ...file,
      parents: [...file.parents],
      capabilities: file.capabilities
        ? { ...file.capabilities }
        : undefined,
    }));
  }

  async download(fileId: string): Promise<Uint8Array> {
    const bytes = this.fileContents[fileId];
    if (!bytes) {
      throw new Error(`Drive file content not found: ${fileId}`);
    }
    return new Uint8Array(bytes);
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

  async createFolder(name: string, parentId: string): Promise<string> {
    const id = `fake-created-${fakeIdCounter += 1}`;
    this.files.push({
      id,
      name,
      parents: [parentId],
      createdTime: new Date().toISOString(),
      mimeType: FOLDER_MIME,
    });
    return id;
  }
}
