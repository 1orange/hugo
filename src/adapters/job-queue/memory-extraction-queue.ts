import type { ExtractionJobData, ExtractionJobQueue, ModelJobData } from "./port";
import { DOCUMENT_PRIORITY, RECEIPT_PRIORITY } from "./port";

/** Keeps what was queued in each lane, once per file, for tests. */
export class MemoryExtractionJobQueue implements ExtractionJobQueue {
  readonly jobs = new Map<string, { data: ExtractionJobData; priority: number }>();
  readonly modelJobs = new Map<string, { data: ModelJobData; priority: number }>();

  async add(data: ExtractionJobData, options: { priority: number }): Promise<boolean> {
    if (this.jobs.has(data.driveFileId) || this.modelJobs.has(data.driveFileId)) {
      return false;
    }
    this.jobs.set(data.driveFileId, { data, priority: options.priority });
    return true;
  }

  async handOff(data: ModelJobData): Promise<boolean> {
    if (this.modelJobs.has(data.driveFileId)) {
      return false;
    }
    this.modelJobs.set(data.driveFileId, {
      data,
      priority: data.kind === "receipt" ? RECEIPT_PRIORITY : DOCUMENT_PRIORITY,
    });
    return true;
  }

  /** The reading job is done: the file can be queued again. */
  finish(driveFileId: string): void {
    this.jobs.delete(driveFileId);
  }

  /** The model job is done. */
  finishModel(driveFileId: string): void {
    this.modelJobs.delete(driveFileId);
  }
}
