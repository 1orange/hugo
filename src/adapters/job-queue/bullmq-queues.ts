import { Queue } from "bullmq";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";
import type { ExtractionJobData, ExtractionJobQueue } from "./port";

export const EXTRACTION_QUEUE = "extraction";
export const SWEEP_QUEUE = "sweep";

export type SweepJobName = "poll" | "notified";

/** BullMQ ids cannot contain ":"; Drive ids are letters, digits, "-" and "_". */
export function extractionJobId(driveFileId: string): string {
  return `doc-${driveFileId}`;
}

type Queues = { extraction?: Queue<ExtractionJobData>; sweep?: Queue };
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

export function sweepQueue(): Queue {
  const state = queues();
  state.sweep ??= new Queue(SWEEP_QUEUE, { connection: openRedisConnection(), prefix: redisKeyPrefix() });
  return state.sweep;
}

export async function closeQueues(): Promise<void> {
  const state = queues();
  const open = [state.extraction, state.sweep].filter((queue) => queue !== undefined);
  state.extraction = undefined;
  state.sweep = undefined;
  await Promise.all(open.map((queue) => queue.close()));
}

/**
 * The extraction queue for any replica: one job per file, its id the file's,
 * so a file queued twice — by two replicas, or twice by one — is one job.
 * A finished job is removed, so the file can be queued again later.
 */
export class BullmqExtractionJobQueue implements ExtractionJobQueue {
  async add(data: ExtractionJobData, options: { priority: number }): Promise<boolean> {
    const queue = extractionQueue();
    const jobId = extractionJobId(data.driveFileId);
    if (await queue.getJob(jobId)) {
      return false;
    }
    // Another replica adding it between the check and here is harmless: BullMQ
    // keeps one job per id, and marking the document pending twice is the same.
    await queue.add("read", data, {
      jobId,
      priority: options.priority,
      removeOnComplete: true,
      removeOnFail: true,
    });
    return true;
  }
}
