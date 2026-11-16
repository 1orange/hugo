import { Queue } from "bullmq";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";
import {
  DOCUMENT_PRIORITY,
  RECEIPT_PRIORITY,
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

type Queues = {
  extraction?: Queue<ExtractionJobData>;
  extractionModel?: Queue<ModelJobData>;
  sweep?: Queue;
  subject?: Queue<SubjectVerificationJobData>;
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

export function subjectQueue(): Queue<SubjectVerificationJobData> {
  const state = queues();
  state.subject ??= new Queue<SubjectVerificationJobData>(SUBJECT_QUEUE, {
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
    await extractionModelQueue().add("model", data, {
      jobId,
      priority: data.kind === "receipt" ? RECEIPT_PRIORITY : DOCUMENT_PRIORITY,
      removeOnComplete: true,
      removeOnFail: true,
    });
    return true;
  }
}

/** Attempts for a verification that was refused by the rate limit: one an hour at most, then given up. */
const SUBJECT_ATTEMPTS = 60;
const SUBJECT_RETRY_MS = 60_000;

/**
 * The party checks for any replica: one job per document, its id the document's,
 * so a document queued twice is one job. A lookup refused by the rate limit is
 * retried a minute later.
 */
export class BullmqSubjectVerificationQueue implements SubjectVerificationQueue {
  async add(data: SubjectVerificationJobData): Promise<boolean> {
    const queue = subjectQueue();
    const jobId = subjectJobId(data.documentId);
    if (await queue.getJob(jobId)) {
      return false;
    }
    await queue.add("verify", data, {
      jobId,
      attempts: SUBJECT_ATTEMPTS,
      backoff: { type: "fixed", delay: SUBJECT_RETRY_MS },
      removeOnComplete: true,
      removeOnFail: true,
    });
    return true;
  }
}

/** BullMQ ids cannot contain ":"; document ids can hold "#", so they are encoded. */
export function subjectJobId(documentId: string): string {
  return `subject-${Buffer.from(documentId).toString("base64url")}`;
}
