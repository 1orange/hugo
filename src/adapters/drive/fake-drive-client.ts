import type { DriveFileRecord } from "@/modules/drive-tree";
import type { DriveChange, DriveChangesFeed, DriveClient } from "./port";

export class FakeDriveClient implements DriveClient {
  constructor(
    protected readonly files: DriveFileRecord[],
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

  /** Every move made, in order, as a test asserts what reached Drive. */
  readonly moves: Array<{ fileId: string; from: string; to: string }> = [];

  async move(fileId: string, fromParentId: string, toParentId: string): Promise<void> {
    const file = this.files.find((entry) => entry.id === fileId);
    if (!file) {
      throw new Error(`Drive file not found: ${fileId}`);
    }
    if (file.capabilities?.canMoveItemWithinDrive === false) {
      throw new Error("Drive refused move: canMoveItemWithinDrive is false");
    }
    if (!file.parents.includes(fromParentId)) {
      throw new Error(`Drive file ${fileId} is not in ${fromParentId}`);
    }
    if (!this.files.some((entry) => entry.id === toParentId)) {
      throw new Error(`Drive folder not found: ${toParentId}`);
    }
    file.parents = file.parents.map((parent) => (parent === fromParentId ? toParentId : parent));
    this.moves.push({ fileId, from: fromParentId, to: toParentId });
  }
}

/**
 * A fake Drive with a change log, for the incremental sweep: every rename,
 * move, addition and removal is logged; a token is a position in the log.
 */
export class FakeDriveClientWithChanges extends FakeDriveClient implements DriveChangesFeed {
  private readonly log: string[] = [];
  /** Tokens before this position are refused, as Drive refuses an expired one. */
  expiredBefore = 0;
  listCalls = 0;
  changesCalls = 0;

  override async list(): Promise<DriveFileRecord[]> {
    this.listCalls += 1;
    return super.list();
  }

  override async rename(fileId: string, newName: string): Promise<void> {
    await super.rename(fileId, newName);
    this.log.push(fileId);
  }

  override async move(fileId: string, fromParentId: string, toParentId: string): Promise<void> {
    await super.move(fileId, fromParentId, toParentId);
    this.log.push(fileId);
  }

  add(file: DriveFileRecord): void {
    this.files.push(file);
    this.log.push(file.id);
  }

  remove(fileId: string): void {
    const index = this.files.findIndex((entry) => entry.id === fileId);
    if (index >= 0) {
      this.files.splice(index, 1);
    }
    this.log.push(fileId);
  }

  async startPageToken(): Promise<string> {
    return String(this.log.length);
  }

  async changesSince(token: string): Promise<{ changes: DriveChange[]; newStartPageToken: string } | null> {
    this.changesCalls += 1;
    const from = Number(token);
    if (!Number.isInteger(from) || from < this.expiredBefore || from > this.log.length) {
      return null;
    }
    const changes = [...new Set(this.log.slice(from))].map((fileId): DriveChange => {
      const file = this.files.find((entry) => entry.id === fileId);
      return file
        ? { fileId, removed: false, file: { ...file, parents: [...file.parents], trashed: false } }
        : { fileId, removed: true, file: null };
    });
    return { changes, newStartPageToken: String(this.log.length) };
  }
}
