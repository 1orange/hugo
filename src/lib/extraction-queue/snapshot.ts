import type { Job } from "bullmq";
import { extractionModelQueue, extractionQueue } from "@/adapters/job-queue/bullmq-queues";
import { priorityFor, type ExtractionJobData, type ModelJobData } from "@/adapters/job-queue/port";
import { readModelLaneSize } from "@/lib/worker/model-lane-size";
import { redis, redisKey } from "@/lib/redis/connection";
import { labelOf, percentOf, type JobProgress } from "./progress";
import { LANE_LABEL, type FinishedJobView, type QueueJobIdentity, type QueueJobView, type QueueLane, type QueueSnapshot } from "./types";
import { waitingMonths, type WaitingEntry } from "./waiting";

/** Finished jobs are removed from BullMQ; how they ended is kept here, newest first. */
const RECENT_KEEP = 100;
const RECENT_SHOWN = 30;
/** Rows of each waiting list the screen gets; the counts are over every job. */
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

/**
 * In the order BullMQ takes them: priority, then age. `job.priority` is the
 * priority BullMQ holds now: a raised month's jobs were moved, and `job.opts`
 * still has the priority they were queued with.
 */
function byTurn(left: Job, right: Job): number {
  return (left.priority ?? 0) - (right.priority ?? 0) || left.timestamp - right.timestamp;
}

const present = <D extends LaneData>(job: Job<D> | undefined): job is Job<D> => Boolean(job?.data);

/**
 * The priority a waiting job is read with now. BullMQ holds it on the job; a job
 * with none (queued by an older build) reads as the tier it queued with.
 */
function priorityOf(job: Job<LaneData>): number {
  if (job.priority) {
    return job.priority;
  }
  return priorityFor(job.data.kind, job.data.tier);
}

function waitingEntry(job: Job<LaneData>, lane: QueueLane): WaitingEntry {
  return {
    lane,
    priority: priorityOf(job),
    timestamp: job.timestamp,
    companyId: job.data.companyId,
    companyName: job.data.companyName,
    monthKey: job.data.monthKey,
  };
}

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
    modelLane,
  ] = await Promise.all([
    reading.getJobs(["active"], 0, LISTED - 1),
    // Every waiting job, not a page of them: the per-month counts need the whole queue
    // (a backlog is thousands of documents). Oldest in take order first.
    reading.getJobs(["prioritized", "waiting"], 0, -1, true),
    reading.getJobs(["delayed"], 0, -1),
    modelling.getJobs(["active"], 0, LISTED - 1),
    modelling.getJobs(["prioritized", "waiting"], 0, -1, true),
    modelling.getJobs(["delayed"], 0, -1),
    redis().lrange(recentKey(), 0, RECENT_KEEP - 1),
    reading.getGlobalConcurrency(),
    modelling.getGlobalConcurrency(),
    readModelLaneSize(),
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

  const readQueued = sorted(readWaiting);
  const modelQueued = sorted(modelWaiting);
  const readDelayedJobs = readDelayed.filter(present);
  const modelDelayedJobs = modelDelayed.filter(present);
  const waiting: WaitingEntry[] = [
    ...readQueued.map((job) => waitingEntry(job, "read")),
    ...readDelayedJobs.map((job) => waitingEntry(job, "read")),
    ...modelQueued.map((job) => waitingEntry(job, "model")),
    ...modelDelayedJobs.map((job) => waitingEntry(job, "model")),
  ];

  return {
    // The model lane's size is what the worker set; the queue's own limit is the fallback for a queue no worker has sized.
    concurrency: { read: readConcurrency ?? 1, model: modelLane?.concurrency ?? modelConcurrency ?? 1 },
    modelSource: modelLane?.source ?? null,
    running: [
      ...views(readActive, "read", "running"),
      ...views(modelActive, "model", "running"),
    ],
    waiting: [
      ...views(readQueued.slice(0, LISTED), "read", "waiting"),
      ...views(modelQueued.slice(0, LISTED), "model", "waiting"),
    ],
    delayed: [
      ...views(readDelayedJobs.slice(0, LISTED), "read", "delayed"),
      ...views(modelDelayedJobs.slice(0, LISTED), "model", "delayed"),
    ],
    recent,
    waitingMonths: waitingMonths(waiting),
  };
}
