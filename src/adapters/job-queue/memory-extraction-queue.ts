import type { ExtractionJobData, ExtractionJobQueue } from "./port";

/** Keeps what was queued, once per file, for tests. */
export class MemoryExtractionJobQueue implements ExtractionJobQueue {
  readonly jobs = new Map<string, { data: ExtractionJobData; priority: number }>();

  async add(data: ExtractionJobData, options: { priority: number }): Promise<boolean> {
    if (this.jobs.has(data.driveFileId)) {
      return false;
    }
    this.jobs.set(data.driveFileId, { data, priority: options.priority });
    return true;
  }

  /** The job is done: the file can be queued again. */
  finish(driveFileId: string): void {
    this.jobs.delete(driveFileId);
  }
}
