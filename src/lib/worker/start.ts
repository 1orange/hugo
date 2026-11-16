import { extractionQueue } from "@/adapters/job-queue/bullmq-queues";
import { createCashDiscoveryDeps } from "@/lib/cash-discovery/schedule";
import { scheduleDrivePoll } from "@/lib/drive-watch/drive-watch";
import { startExtractionWorker } from "./extraction-worker";
import { fallbackModelConcurrency } from "./model-lane-size";
import { startModelWorker } from "./model-worker";
import { startServiceMonitor } from "./service-monitor";
import { startSubjectWorker } from "./subject-worker";
import { startSweepWorker } from "./sweep-worker";

/**
 * Documents read at once across every worker by the reading lane: downloads,
 * text, OCR. Not the model's limit: while the model is busy these go on.
 */
export function readConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.READ_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? value : 3;
}

export type RunningWorker = { close(): Promise<void> };

/**
 * Everything a worker does. Several can run: the limits on documents read and
 * read by the model at once are the queues', not each worker's, so a second
 * worker adds resilience without a second request to a one-slot model.
 */
export async function startWorker(env: NodeJS.ProcessEnv = process.env): Promise<RunningWorker> {
  const deps = createCashDiscoveryDeps(env);
  const reading = readConcurrency(env);
  await extractionQueue().setGlobalConcurrency(reading);

  const readLane = startExtractionWorker(deps, reading);
  // The model lane's limit is the server's slots, asked now: the fallback until it answers.
  const modelLane = startModelWorker(deps.extractor, fallbackModelConcurrency(env));
  await modelLane.resize(env);
  const sweep = startSweepWorker(env);
  const subject = startSubjectWorker(env);
  const stopMonitor = startServiceMonitor(env, { onModelReady: () => modelLane.resize(env) });
  await scheduleDrivePoll(env);

  for (const { worker } of [readLane, modelLane, sweep, subject]) {
    worker.on("failed", (job, error) => console.warn(`[worker] ${worker.name} job ${job?.id} failed`, error));
    worker.on("error", (error) => console.warn(`[worker] ${worker.name}`, error));
  }

  return {
    async close() {
      stopMonitor();
      // Waits for a document being read, or a sweep, to finish. With none there
      // is nothing to wait for — and BullMQ's graceful close needs Redis: a
      // Redis stopping at the same moment held the pod for its whole grace.
      await Promise.all([
        readLane.worker.close(!readLane.busy()),
        modelLane.worker.close(!modelLane.busy()),
        sweep.worker.close(!sweep.busy()),
        subject.worker.close(!subject.busy()),
      ]);
    },
  };
}
