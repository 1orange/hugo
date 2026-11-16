import { DelayedError, type Job } from "bullmq";
import { announce } from "@/lib/events/bus";
import type { ExtractionJobResult } from "@/lib/extraction-queue/process-job";
import { ProgressReporter } from "@/lib/extraction-queue/progress";
import { recordFinishedJob } from "@/lib/extraction-queue/snapshot";

/**
 * A document whose model or OCR is down waits this long before it is tried
 * again — or less: the service monitor retries every waiting document the
 * moment the service is back.
 */
export const WAIT_FOR_SERVICE_MS = 60_000;

type LaneJobData = {
  driveFileId: string;
  kind: "receipt" | "document";
  companyId: number;
  companyName: string;
  monthKey: string;
  fileName: string;
  waitingReason?: string | null;
};

/**
 * Runs one job of either lane. The lane's work reports its progress; a job
 * that waits for a service is moved aside; a handed-over document is left for
 * the model lane, which records it. Only a finished document is recorded, so
 * each document is recorded once, by the lane that finishes it.
 */
export async function runLaneJob<T extends LaneJobData>(
  job: Job<T>,
  token: string | undefined,
  work: (reporter: ProgressReporter) => Promise<ExtractionJobResult>,
  options: { startedAt?: number } = {},
): Promise<ExtractionJobResult> {
  const reporter = new ProgressReporter((progress) => {
    job.updateProgress(progress).then(
      () => announce({ type: "queue-changed" }),
      (error: unknown) => console.warn("[worker] could not store progress", error),
    );
  });
  announce({ type: "queue-changed" });
  const result = await work(reporter);

  if (result.outcome === "handed") {
    announce({ type: "queue-changed" });
    return result;
  }
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
    durationMs: Date.now() - (options.startedAt ?? reporter.current.startedAt),
    outcome,
    reason: result.reason,
    stages: reporter.stages,
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
