import { Worker } from "bullmq";
import { SWEEP_QUEUE, type SweepJobName } from "@/adapters/job-queue/bullmq-queues";
import { ensureDriveWatchChannel } from "@/lib/drive-watch/drive-watch";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";
import { syncDriveAndQueueExtraction } from "@/lib/sweep/ensure-fresh-sweep";

/**
 * Sweeps on the poll's schedule and after Drive notifications, one at a time
 * across every worker; the poll also keeps the Drive channel alive.
 */
export function startSweepWorker(env: NodeJS.ProcessEnv = process.env): Worker {
  return new Worker(
    SWEEP_QUEUE,
    async (job) => {
      if ((job.name as SweepJobName) === "poll") {
        await ensureDriveWatchChannel(env).catch((error: unknown) =>
          console.warn("[worker] could not watch Drive changes", error),
        );
      }
      await syncDriveAndQueueExtraction(env);
    },
    { connection: openRedisConnection(), prefix: redisKeyPrefix(), concurrency: 1 },
  );
}
