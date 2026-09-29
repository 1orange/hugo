import { DelayedError, Worker, type Job } from "bullmq";
import { EXTRACTION_QUEUE } from "@/adapters/job-queue/bullmq-queues";
import type { ExtractionJobData } from "@/adapters/job-queue/port";
import type { CashDiscoveryDeps } from "@/lib/cash-discovery/discover-cash-payments";
import { announce } from "@/lib/events/bus";
import { processExtractionJob } from "@/lib/extraction-queue/process-job";
import { ProgressReporter } from "@/lib/extraction-queue/progress";
import { recordFinishedJob } from "@/lib/extraction-queue/snapshot";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";

/**
 * A document whose model or OCR is down waits this long before it is tried
 * again — or less: the service monitor retries every waiting document the
 * moment the service is back.
 */
export const WAIT_FOR_SERVICE_MS = 60_000;

/**
 * Reads documents off the shared queue. BullMQ hands each job to one worker
 * at a time and keeps the lock alive while the model writes; a worker that
 * dies mid-document gives its job back after the lock lapses.
 */
export function startExtractionWorker(
  deps: CashDiscoveryDeps,
  concurrency: number,
): { worker: Worker<ExtractionJobData>; busy: () => boolean } {
  let reading = 0;
  const worker = new Worker<ExtractionJobData>(
    EXTRACTION_QUEUE,
    async (job, token) => {
      reading += 1;
      try {
        return await readOne(job, token);
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

  async function readOne(job: Job<ExtractionJobData>, token: string | undefined) {
    const reporter = new ProgressReporter((progress) => {
      job.updateProgress(progress).then(
        () => announce({ type: "queue-changed" }),
        (error: unknown) => console.warn("[worker] could not store progress", error),
      );
    });
    announce({ type: "queue-changed" });
    const result = await processExtractionJob(job.data, deps, reporter);

    if (result.outcome === "waiting") {
      await job.updateData({ ...job.data, waitingReason: result.reason });
      await job.moveToDelayed(Date.now() + WAIT_FOR_SERVICE_MS, token!);
      announce({ type: "queue-changed" });
      throw new DelayedError();
    }

    const outcome = result.outcome;
    await recordFinishedJob({
      driveFileId: job.data.driveFileId,
      kind: job.data.kind,
      companyId: job.data.companyId,
      companyName: job.data.companyName,
      monthKey: job.data.monthKey,
      fileName: job.data.fileName,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - reporter.current.startedAt,
      outcome,
      reason: result.reason,
    });
    announce({
      type: "document-read",
      companyId: job.data.companyId,
      monthKey: job.data.monthKey,
      driveFileId: job.data.driveFileId,
      outcome,
    });
    announce({ type: "queue-changed" });
    return result;
  }
}
