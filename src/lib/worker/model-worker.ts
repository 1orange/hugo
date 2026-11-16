import { Worker } from "bullmq";
import { EXTRACTION_MODEL_QUEUE } from "@/adapters/job-queue/bullmq-queues";
import type { Extractor } from "@/adapters/extractor/port";
import type { ModelJobData } from "@/adapters/job-queue/port";
import { processModelJob } from "@/lib/extraction-queue/process-model-job";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";
import { runLaneJob } from "./run-lane-job";

/**
 * The model lane: only the model's call, the checks and the write. Its
 * concurrency is the model server's slots, and nothing else waits behind it:
 * the reading lane goes on with the next documents meanwhile.
 */
export function startModelWorker(
  extractor: Extractor,
  concurrency: number,
): { worker: Worker<ModelJobData>; busy: () => boolean } {
  let reading = 0;
  const worker = new Worker<ModelJobData>(
    EXTRACTION_MODEL_QUEUE,
    async (job, token) => {
      reading += 1;
      try {
        return await runLaneJob(
          job,
          token,
          (reporter) => processModelJob(job.data, { extractor }, reporter),
          { startedAt: job.data.readStartedAt },
        );
      } finally {
        reading -= 1;
      }
    },
    {
      connection: openRedisConnection(),
      prefix: redisKeyPrefix(),
      concurrency,
      // The model writes for minutes; BullMQ renews the lock at half of this.
      lockDuration: 60_000,
    },
  );
  return { worker, busy: () => reading > 0 };
}
