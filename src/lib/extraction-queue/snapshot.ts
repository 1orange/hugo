import type { Job } from "bullmq";
import { extractionModelQueue, extractionQueue } from "@/adapters/job-queue/bullmq-queues";
import type { ExtractionJobData, ModelJobData } from "@/adapters/job-queue/port";
import { redis, redisKey } from "@/lib/redis/connection";
import { labelOf, percentOf, type JobProgress } from "./progress";
import { LANE_LABEL, type FinishedJobView, type QueueJobIdentity, type QueueJobView, type QueueLane, type QueueSnapshot } from "./types";

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

type LaneData = ExtractionJobData | ModelJobData;

function identityOf(data: LaneData): QueueJobIdentity {
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

function jobView(job: Job<LaneData>, lane: QueueLane, state: QueueJobView["state"], now: number): QueueJobView {
  const progress = state === "running" && isProgress(job.progress) ? job.progress : null;
  const text = progress ? labelOf(progress) : state === "delayed" ? "Čaká na službu" : "V rade";
  return {
    ...identityOf(job.data),
    lane,
    state,
    enqueuedAt: job.data.enqueuedAt,
    startedAt: progress ? new Date(progress.startedAt).toISOString() : null,
    stage: progress?.stage ?? (state === "running" ? "download" : "queued"),
    stageLabel: `${LANE_LABEL[lane]} · ${text}`,
    percent: progress ? percentOf(progress, now) : 0,
    elapsedMs: progress ? now - progress.startedAt : 0,
    waitingReason: state === "delayed" ? (job.data.waitingReason ?? null) : null,
  };
}

/** In the order BullMQ takes them: priority, then age. */
function byTurn(left: Job, right: Job): number {
  return (left.opts.priority ?? 0) - (right.opts.priority ?? 0) || left.timestamp - right.timestamp;
}

const present = <D extends LaneData>(job: Job<D> | undefined): job is Job<D> => Boolean(job?.data);

/** What every worker is doing and what waits, in both lanes, as any web replica sees it. */
export async function loadQueueSnapshot(now: number = Date.now()): Promise<QueueSnapshot> {
  const reading = extractionQueue();
  const modelling = extractionModelQueue();
  const [
    readActive,
    readWaiting,
    readDelayed,
    modelActive,
    modelWaiting,
    modelDelayed,
    recentRaw,
    readConcurrency,
    modelConcurrency,
  ] = await Promise.all([
    reading.getJobs(["active"], 0, LISTED - 1),
    reading.getJobs(["prioritized", "waiting"], 0, LISTED - 1),
    reading.getJobs(["delayed"], 0, LISTED - 1),
    modelling.getJobs(["active"], 0, LISTED - 1),
    modelling.getJobs(["prioritized", "waiting"], 0, LISTED - 1),
    modelling.getJobs(["delayed"], 0, LISTED - 1),
    redis().lrange(recentKey(), 0, RECENT_KEEP - 1),
    reading.getGlobalConcurrency(),
    modelling.getGlobalConcurrency(),
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

  const views = (jobs: Job<LaneData>[], lane: QueueLane, state: QueueJobView["state"]) =>
    jobs.filter(present).map((job) => jobView(job, lane, state, now));
  const sorted = (jobs: Job<LaneData>[]) => jobs.filter(present).sort(byTurn);

  return {
    concurrency: { read: readConcurrency ?? 1, model: modelConcurrency ?? 1 },
    running: [
      ...views(readActive, "read", "running"),
      ...views(modelActive, "model", "running"),
    ],
    waiting: [
      ...views(sorted(readWaiting), "read", "waiting"),
      ...views(sorted(modelWaiting), "model", "waiting"),
    ],
    delayed: [
      ...views(readDelayed, "read", "delayed"),
      ...views(modelDelayed, "model", "delayed"),
    ],
    recent,
  };
}
