import type {
  ClientSubjectVerificationJobData,
  SubjectVerificationJobData,
  SubjectVerificationQueue,
} from "./port";

/** Keeps what was queued, once per document and per client subject, for tests and for a process without Redis. */
export class MemorySubjectVerificationQueue implements SubjectVerificationQueue {
  readonly jobs = new Map<string, SubjectVerificationJobData>();
  readonly clientJobs = new Map<number, ClientSubjectVerificationJobData>();

  async add(data: SubjectVerificationJobData): Promise<boolean> {
    if (this.jobs.has(data.documentId)) {
      return false;
    }
    this.jobs.set(data.documentId, data);
    return true;
  }

  async addClientSubject(data: ClientSubjectVerificationJobData): Promise<boolean> {
    if (this.clientJobs.has(data.subjectId)) {
      return false;
    }
    this.clientJobs.set(data.subjectId, data);
    return true;
  }

  /** The job is done: the document can be queued again. */
  finish(documentId: string): void {
    this.jobs.delete(documentId);
  }

  /** The client's job is done: its subject can be queued again. */
  finishClient(subjectId: number): void {
    this.clientJobs.delete(subjectId);
  }
}
