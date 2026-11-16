import { Worker } from "bullmq";
import { EXTRACTION_MODEL_QUEUE } from "@/adapters/job-queue/bullmq-queues";
import type { Extractor } from "@/adapters/extractor/port";
import type { ModelJobData } from "@/adapters/job-queue/port";
import { processModelJob } from "@/lib/extraction-queue/process-model-job";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";
import { applyModelLaneSize, chooseModelLaneSize, type ModelLaneSize } from "./model-lane-size";
import { runLaneJob } from "./run-lane-job";

export type ModelLane = {
  worker: Worker<ModelJobData>;
  busy: () => boolean;
  /**
   * Sizes the lane to the model server's slots, or to the fallback when it does
   * not answer. Called at start, and again each time the service monitor sees the
   * model ready. Logs when the size changes.
   */
  resize: (env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch) => Promise<ModelLaneSize>;
};

/**
 * The model lane: only the model's call, the checks and the write. Its
 * concurrency is the model server's slots, and nothing else waits behind it:
 * the reading lane goes on with the next documents meanwhile. `concurrency` is
 * only the start, until resize has asked the server.
 */
export function startModelWorker(extractor: Extractor, concurrency: number): ModelLane {
  let reading = 0;
  let sized: ModelLaneSize | null = null;
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

  const resize = async (env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch) => {
    const size = await chooseModelLaneSize(env, fetchImpl);
    await applyModelLaneSize(worker, size);
    if (sized === null || sized.concurrency !== size.concurrency || sized.source !== size.source) {
      console.info(
        size.source === "server"
          ? `[worker] model lane: ${size.concurrency} at once, from the model server's slots (-np)`
          : `[worker] model lane: ${size.concurrency} at once, the fallback (EXTRACTOR_CONCURRENCY or 1); ${size.reason}`,
      );
    }
    sized = size;
    return size;
  };

  return { worker, busy: () => reading > 0, resize };
}
