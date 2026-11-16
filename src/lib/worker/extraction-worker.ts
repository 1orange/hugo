import { Worker } from "bullmq";
import { BullmqExtractionJobQueue, EXTRACTION_QUEUE } from "@/adapters/job-queue/bullmq-queues";
import type { ExtractionJobData, ModelJobData } from "@/adapters/job-queue/port";
import type { CashDiscoveryDeps } from "@/lib/cash-discovery/discover-cash-payments";
import { processExtractionJob } from "@/lib/extraction-queue/process-job";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";
import { runLaneJob } from "./run-lane-job";

/**
 * The reading lane: downloads each document and does everything but the model
 * (text layer, ISDOC and MOL, QR, eKasa lookup, OCR). A document that needs the
 * model is handed to the model lane (model-worker) with its text lines.
 *
 * BullMQ hands each job to one worker at a time and keeps the lock alive while
 * the reading runs; a worker that dies mid-document gives its job back after
 * the lock lapses.
 */
export function startExtractionWorker(
  deps: CashDiscoveryDeps,
  concurrency: number,
): { worker: Worker<ExtractionJobData>; busy: () => boolean } {
  let reading = 0;
  const queue = new BullmqExtractionJobQueue();
  const handOff = (job: ModelJobData) => queue.handOff(job);
  const worker = new Worker<ExtractionJobData>(
    EXTRACTION_QUEUE,
    async (job, token) => {
      reading += 1;
      try {
        return await runLaneJob(job, token, (reporter) =>
          processExtractionJob(job.data, deps, reporter, handOff),
        );
      } finally {
        reading -= 1;
      }
    },
    {
      connection: openRedisConnection(),
      prefix: redisKeyPrefix(),
      concurrency,
      // Reading a document can take minutes; BullMQ renews the lock at half of this.
      lockDuration: 60_000,
    },
  );
  return { worker, busy: () => reading > 0 };
}
