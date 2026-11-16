import { Queue } from "bullmq";
import { openRedisConnection, redis, redisKey, redisKeyPrefix } from "@/lib/redis/connection";
import {
  priorityFor,
  type ClientSubjectVerificationJobData,
  type ExtractionJobData,
  type ExtractionJobQueue,
  type ModelJobData,
  type SubjectVerificationJobData,
  type SubjectVerificationQueue,
} from "./port";

/**
 * The reading lane. Its name predates the split: documents queued before it
 * keep their place.
 */
export const EXTRACTION_QUEUE = "extraction";
/** The model lane: the model's slots, and nothing else (ADR 0020). */
export const EXTRACTION_MODEL_QUEUE = "extraction-model";
export const SWEEP_QUEUE = "sweep";
export const SUBJECT_QUEUE = "subject";

export type SweepJobName = "poll" | "notified";

/** BullMQ ids cannot contain ":"; Drive ids are letters, digits, "-" and "_". */
export function extractionJobId(driveFileId: string): string {
  return `doc-${driveFileId}`;
}

/**
 * How long a month stays raised for documents handed over later. Long enough
 * for the reading and the model backlog of a working session, and no longer:
 * after it, a document is queued at the normal priority again.
 */
const RAISED_MONTH_SECONDS = 12 * 60 * 60;

function raisedMonthKey(companyId: number, monthKey: string): string {
  return redisKey("extraction", "raised", String(companyId), monthKey);
}

type Queues = {
  extraction?: Queue<ExtractionJobData>;
  extractionModel?: Queue<ModelJobData>;
  sweep?: Queue;
  subject?: Queue<SubjectVerificationJobData | ClientSubjectVerificationJobData>;
};
const QUEUES_KEY = Symbol.for("hugo.bullmqQueues");

function queues(): Queues {
  const global = globalThis as unknown as Record<symbol, Queues | undefined>;
  return (global[QUEUES_KEY] ??= {});
}

export function extractionQueue(): Queue<ExtractionJobData> {
  const state = queues();
  state.extraction ??= new Queue<ExtractionJobData>(EXTRACTION_QUEUE, {
    connection: openRedisConnection(),
    prefix: redisKeyPrefix(),
  });
  return state.extraction;
}

export function extractionModelQueue(): Queue<ModelJobData> {
  const state = queues();
  state.extractionModel ??= new Queue<ModelJobData>(EXTRACTION_MODEL_QUEUE, {
    connection: openRedisConnection(),
    prefix: redisKeyPrefix(),
  });
  return state.extractionModel;
}

export function subjectQueue(): Queue<SubjectVerificationJobData | ClientSubjectVerificationJobData> {
  const state = queues();
  state.subject ??= new Queue<SubjectVerificationJobData | ClientSubjectVerificationJobData>(SUBJECT_QUEUE, {
    connection: openRedisConnection(),
    prefix: redisKeyPrefix(),
  });
  return state.subject;
}

export function sweepQueue(): Queue {
  const state = queues();
  state.sweep ??= new Queue(SWEEP_QUEUE, { connection: openRedisConnection(), prefix: redisKeyPrefix() });
  return state.sweep;
}

export async function closeQueues(): Promise<void> {
  const state = queues();
  const open = [state.extraction, state.extractionModel, state.sweep, state.subject].filter(
    (queue) => queue !== undefined,
  );
  state.extraction = undefined;
  state.extractionModel = undefined;
  state.sweep = undefined;
  state.subject = undefined;
  await Promise.all(open.map((queue) => queue.close()));
}

/**
 * The extraction queues for any replica: one job per file in each lane, its id
 * the file's, so a file queued twice — by two replicas, or twice by one — is one
 * job. A finished job is removed, so the file can be queued again later.
 */
export class BullmqExtractionJobQueue implements ExtractionJobQueue {
  async add(data: ExtractionJobData, options: { priority: number }): Promise<boolean> {
    const jobId = extractionJobId(data.driveFileId);
    // A document the model lane holds is finished there: reading it again would
    // download and OCR it twice for nothing.
    if (await extractionModelQueue().getJob(jobId)) {
      return false;
    }
    if (await extractionQueue().getJob(jobId)) {
      return false;
    }
    // Another replica adding it between the check and here is harmless: BullMQ
    // keeps one job per id, and marking the document pending twice is the same.
    await extractionQueue().add("read", data, {
      jobId,
      priority: options.priority,
      removeOnComplete: true,
      removeOnFail: true,
    });
    return true;
  }

  async handOff(data: ModelJobData): Promise<boolean> {
    const jobId = extractionJobId(data.driveFileId);
    // The reading lane hands a document over once, so a job already here was
    // queued from the same text; keeping it is right.
    if (await extractionModelQueue().getJob(jobId)) {
      return false;
    }
    // Read here, not from the job data: the month may have been opened while
    // the document was still being read, and the reading job cannot be changed.
    const raised = (await redis().exists(raisedMonthKey(data.companyId, data.monthKey))) === 1;
    await extractionModelQueue().add("model", data, {
      jobId,
      priority: priorityFor(data.kind, raised),
      removeOnComplete: true,
      removeOnFail: true,
    });
    return true;
  }

  async raiseMonth(companyId: number, monthKey: string): Promise<number> {
    // The mark goes first, so a document handed over while the raise runs is
    // raised too. Opening the month again only rewrites the mark.
    await redis().set(raisedMonthKey(companyId, monthKey), "1", "EX", RAISED_MONTH_SECONDS);
    const reading = await raiseWaiting(extractionQueue(), companyId, monthKey);
    const modelling = await raiseWaiting(extractionModelQueue(), companyId, monthKey);
    return reading + modelling;
  }
}

/**
 * Moves the month's jobs that wait in one lane to the raised priority. A job
 * already there is left alone, so opening the month again moves nothing. The
 * priority is read from `job.priority`: BullMQ's changePriority updates that, not
 * `job.opts`. A delayed job (waiting for the model or OCR) takes the new priority
 * when it is promoted.
 */
async function raiseWaiting<D extends ExtractionJobData | ModelJobData>(
  queue: Queue<D>,
  companyId: number,
  monthKey: string,
): Promise<number> {
  // In the order BullMQ takes them, so the raised jobs keep their order among
  // themselves. Newest first would reverse it.
  const jobs = await queue.getJobs(["waiting", "prioritized", "delayed"], 0, -1, true);
  let moved = 0;
  for (const job of jobs) {
    if (job.data.companyId !== companyId || job.data.monthKey !== monthKey) {
      continue;
    }
    const priority = priorityFor(job.data.kind, true);
    if (job.priority !== priority) {
      await job.changePriority({ priority });
      moved += 1;
    }
  }
  return moved;
}

/** Attempts for a verification that was refused by the rate limit: one an hour at most, then given up. */
const SUBJECT_ATTEMPTS = 60;
const SUBJECT_RETRY_MS = 60_000;

/** The job names on the subject queue: a document's party check, or one client subject's check. */
export const DOCUMENT_SUBJECT_JOB = "verify";
export const CLIENT_SUBJECT_JOB = "verify-client";

/**
 * The party checks for any replica: one job per document, its id the document's,
 * so a document queued twice is one job. A lookup refused by the rate limit is
 * retried a minute later.
 */
export class BullmqSubjectVerificationQueue implements SubjectVerificationQueue {
  async add(data: SubjectVerificationJobData): Promise<boolean> {
    return addSubjectJob(subjectJobId(data.documentId), DOCUMENT_SUBJECT_JOB, data);
  }

  async addClientSubject(data: ClientSubjectVerificationJobData): Promise<boolean> {
    return addSubjectJob(clientSubjectJobId(data.subjectId), CLIENT_SUBJECT_JOB, data);
  }
}

async function addSubjectJob(
  jobId: string,
  name: string,
  data: SubjectVerificationJobData | ClientSubjectVerificationJobData,
): Promise<boolean> {
  const queue = subjectQueue();
  if (await queue.getJob(jobId)) {
    return false;
  }
  await queue.add(name, data, {
    jobId,
    attempts: SUBJECT_ATTEMPTS,
    backoff: { type: "fixed", delay: SUBJECT_RETRY_MS },
    removeOnComplete: true,
    removeOnFail: true,
  });
  return true;
}

/** BullMQ ids cannot contain ":"; document ids can hold "#", so they are encoded. */
export function subjectJobId(documentId: string): string {
  return `subject-${Buffer.from(documentId).toString("base64url")}`;
}

/** One job per client subject, whichever replica queues it. */
export function clientSubjectJobId(subjectId: number): string {
  return `subject-client-${subjectId}`;
}
