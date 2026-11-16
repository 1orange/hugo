import type { SubjectVerificationJobData, SubjectVerificationQueue } from "./port";

/** Keeps what was queued, once per document, for tests and for a process without Redis. */
export class MemorySubjectVerificationQueue implements SubjectVerificationQueue {
  readonly jobs = new Map<string, SubjectVerificationJobData>();

  async add(data: SubjectVerificationJobData): Promise<boolean> {
    if (this.jobs.has(data.documentId)) {
      return false;
    }
    this.jobs.set(data.documentId, data);
    return true;
  }

  /** The job is done: the document can be queued again. */
  finish(documentId: string): void {
    this.jobs.delete(documentId);
  }
}
