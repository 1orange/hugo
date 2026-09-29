import type { Job } from "bullmq";
import { extractionQueue } from "@/adapters/job-queue/bullmq-queues";
import type { ExtractionJobData } from "@/adapters/job-queue/port";
import { redis, redisKey } from "@/lib/redis/connection";
import { labelOf, percentOf, type JobProgress } from "./progress";
import type { FinishedJobView, QueueJobIdentity, QueueJobView, QueueSnapshot } from "./types";

/** Finished jobs are removed from BullMQ; how they ended is kept here, newest first. */
const RECENT_KEEP = 100;
const RECENT_SHOWN = 30;
const LISTED = 200;

function recentKey(): string {
  return redisKey("extraction", "recent");
}

export async function recordFinishedJob(view: FinishedJobView): Promise<void> {
  await redis()
    .multi()
    .lpush(recentKey(), JSON.stringify(view))
    .ltrim(recentKey(), 0, RECENT_KEEP - 1)
    .exec();
}

function identityOf(data: ExtractionJobData): QueueJobIdentity {
  return {
    driveFileId: data.driveFileId,
    kind: data.kind,
    companyId: data.companyId,
    companyName: data.companyName,
    monthKey: data.monthKey,
    fileName: data.fileName,
  };
}

function isProgress(value: unknown): value is JobProgress {
  return typeof value === "object" && value !== null && "stage" in value && "startedAt" in value;
}

function jobView(job: Job<ExtractionJobData>, state: QueueJobView["state"], now: number): QueueJobView {
  const progress = state === "running" && isProgress(job.progress) ? job.progress : null;
  return {
    ...identityOf(job.data),
    state,
    enqueuedAt: job.data.enqueuedAt,
    startedAt: progress ? new Date(progress.startedAt).toISOString() : null,
    stage: progress?.stage ?? (state === "running" ? "download" : "queued"),
    stageLabel: progress ? labelOf(progress) : state === "delayed" ? "Čaká na službu" : "V rade",
    percent: progress ? percentOf(progress, now) : 0,
    elapsedMs: progress ? now - progress.startedAt : 0,
    waitingReason: state === "delayed" ? (job.data.waitingReason ?? null) : null,
  };
}

/** In the order BullMQ takes them: priority, then age. */
function byTurn(left: Job, right: Job): number {
  return (left.opts.priority ?? 0) - (right.opts.priority ?? 0) || left.timestamp - right.timestamp;
}

/** What every worker is doing and what waits, as any web replica sees it. */
export async function loadQueueSnapshot(now: number = Date.now()): Promise<QueueSnapshot> {
  const queue = extractionQueue();
  const [active, waiting, delayed, recentRaw, concurrency] = await Promise.all([
    queue.getJobs(["active"], 0, LISTED - 1),
    queue.getJobs(["prioritized", "waiting"], 0, LISTED - 1),
    queue.getJobs(["delayed"], 0, LISTED - 1),
    redis().lrange(recentKey(), 0, RECENT_KEEP - 1),
    queue.getGlobalConcurrency(),
  ]);

  const seen = new Set<string>();
  const recent: FinishedJobView[] = [];
  for (const raw of recentRaw) {
    const view = JSON.parse(raw) as FinishedJobView;
    if (!seen.has(view.driveFileId) && recent.length < RECENT_SHOWN) {
      seen.add(view.driveFileId);
      recent.push(view);
    }
  }

  const present = (job: Job<ExtractionJobData> | undefined): job is Job<ExtractionJobData> => Boolean(job?.data);
  return {
    concurrency: concurrency ?? 1,
    running: active.filter(present).map((job) => jobView(job, "running", now)),
    waiting: waiting.filter(present).sort(byTurn).map((job) => jobView(job, "waiting", now)),
    delayed: delayed.filter(present).map((job) => jobView(job, "delayed", now)),
    recent,
  };
}
