import { extractionQueue } from "@/adapters/job-queue/bullmq-queues";
import { createCashDiscoveryDeps } from "@/lib/cash-discovery/schedule";
import { scheduleDrivePoll } from "@/lib/drive-watch/drive-watch";
import { startExtractionWorker } from "./extraction-worker";
import { startServiceMonitor } from "./service-monitor";
import { startSweepWorker } from "./sweep-worker";

/** Documents read at once across every worker: the model server's slots (EXTRACTOR_PARALLEL). */
export function extractionConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.EXTRACTOR_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export type RunningWorker = { close(): Promise<void> };

/**
 * Everything a worker does. Several can run: the limit on documents read at
 * once is the queue's, not each worker's, so a second worker adds resilience
 * without a second request to a one-slot model.
 */
export async function startWorker(env: NodeJS.ProcessEnv = process.env): Promise<RunningWorker> {
  const deps = createCashDiscoveryDeps(env);
  const concurrency = extractionConcurrency(env);
  await extractionQueue().setGlobalConcurrency(concurrency);

  const extraction = startExtractionWorker(deps, concurrency);
  const sweep = startSweepWorker(env);
  const stopMonitor = startServiceMonitor(env);
  await scheduleDrivePoll(env);

  for (const { worker } of [extraction, sweep]) {
    worker.on("failed", (job, error) => console.warn(`[worker] ${worker.name} job ${job?.id} failed`, error));
    worker.on("error", (error) => console.warn(`[worker] ${worker.name}`, error));
  }

  return {
    async close() {
      stopMonitor();
      // Waits for a document being read, or a sweep, to finish. With neither
      // there is nothing to wait for — and BullMQ's graceful close needs Redis:
      // a Redis stopping at the same moment held the pod for its whole grace.
      await Promise.all([
        extraction.worker.close(!extraction.busy()),
        sweep.worker.close(!sweep.busy()),
      ]);
    },
  };
}
