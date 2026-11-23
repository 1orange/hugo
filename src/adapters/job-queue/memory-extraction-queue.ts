import type { ExtractionJobData, ExtractionJobQueue, ModelJobData } from "./port";
import { priorityFor } from "./port";

/** Keeps what was queued in each lane, once per file, for tests. */
export class MemoryExtractionJobQueue implements ExtractionJobQueue {
  readonly jobs = new Map<string, { data: ExtractionJobData; priority: number }>();
  readonly modelJobs = new Map<string, { data: ModelJobData; priority: number }>();
  /** Months opened since they were queued: documents handed over later keep the raise. */
  private readonly raisedMonths = new Set<string>();

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
      priority: priorityFor(data.kind, this.raisedMonths.has(monthId(data)) ? "raised" : data.tier),
    });
    return true;
  }

  async raiseMonth(companyId: number, monthKey: string): Promise<number> {
    const id = monthId({ companyId, monthKey });
    this.raisedMonths.add(id);
    let moved = 0;
    for (const entry of [...this.jobs.values(), ...this.modelJobs.values()]) {
      const { data } = entry;
      if (monthId(data) !== id) {
        continue;
      }
      const priority = priorityFor(data.kind, "raised");
      if (entry.priority !== priority) {
        entry.priority = priority;
        moved += 1;
      }
    }
    return moved;
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

function monthId(job: { companyId: number; monthKey: string }): string {
  return `${job.companyId}/${job.monthKey}`;
}
