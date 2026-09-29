/**
 * What the month screen learns from the extraction queue: how far each of its
 * documents is, and whether its own data is behind. The server pushes each
 * finished document (ADR 0021); this reads the queue snapshot that also comes
 * with every reconnect, to catch what was missed while disconnected.
 */

type JobRef = { driveFileId: string; companyId: number; monthKey: string };
type ServiceStateRef = { state: string };

/** The part of the queue page's data this needs (extraction-queue view). */
export type WatchedQueue = {
  running: Array<JobRef & { percent: number; stageLabel: string }>;
  waiting: JobRef[];
  /** Waiting for the model or OCR. */
  delayed: JobRef[];
  recent: Array<JobRef & { outcome: "complete" | "failed" }>;
  services: { model: ServiceStateRef; ocr: ServiceStateRef };
};

export type LiveExtraction =
  | { state: "running"; percent: number; stageLabel: string }
  /** 1-based, in the whole app's queue: other companies' documents go first too. */
  | { state: "waiting"; position: number }
  | { state: "blocked"; label: string };

/** Why the screen should render again, or null while nothing it shows has changed. */
export type RefreshReason = "finished" | "service-recovered" | "idle";

const READY_STATES = new Set(["ok", "stub"]);

export function servicesReady(queue: WatchedQueue): boolean {
  return READY_STATES.has(queue.services.model.state) && READY_STATES.has(queue.services.ocr.state);
}

function blockedLabel(queue: WatchedQueue): string {
  if (!READY_STATES.has(queue.services.model.state)) {
    return queue.services.model.state === "loading" ? "Čaká, kým sa model načíta" : "Čaká na model — nedostupný";
  }
  if (!READY_STATES.has(queue.services.ocr.state)) {
    return "Čaká na OCR — nedostupné";
  }
  return "Čaká na spracovanie";
}

function inMonth(job: JobRef, companyId: number, monthKey: string): boolean {
  return job.companyId === companyId && job.monthKey === monthKey;
}

/** Each of the month's files the queue knows about, by Drive file id. */
export function liveExtractionByFile(
  queue: WatchedQueue,
  companyId: number,
  monthKey: string,
): Map<string, LiveExtraction> {
  const live = new Map<string, LiveExtraction>();
  for (const job of queue.running) {
    if (inMonth(job, companyId, monthKey)) {
      live.set(job.driveFileId, { state: "running", percent: job.percent, stageLabel: job.stageLabel });
    }
  }
  queue.waiting.forEach((job, index) => {
    if (inMonth(job, companyId, monthKey)) {
      live.set(job.driveFileId, { state: "waiting", position: index + 1 });
    }
  });
  for (const job of queue.delayed) {
    if (inMonth(job, companyId, monthKey) && !live.has(job.driveFileId)) {
      live.set(job.driveFileId, { state: "blocked", label: blockedLabel(queue) });
    }
  }
  return live;
}

/**
 * Whether the screen, showing `pendingFileIds` as still being read, is behind:
 *
 * - "finished": one of them was read (or failed) since — its values are waiting.
 * - "service-recovered": the model or OCR was not ready and now is; a render
 *   queues the documents that waited for it again.
 * - "idle": none of them is queued although both are ready — the queue was
 *   lost to a restart, or they were never queued. The caller rate-limits it.
 *
 * A file that is queued again keeps its last result in `recent` until the new
 * one lands, so only files no longer queued are read from it.
 */
export function refreshReason(input: {
  queue: WatchedQueue;
  companyId: number;
  monthKey: string;
  pendingFileIds: readonly string[];
  /** servicesReady() at the previous poll; null on the first. */
  wereServicesReady: boolean | null;
}): RefreshReason | null {
  const { queue, companyId, monthKey, pendingFileIds } = input;
  if (pendingFileIds.length === 0) {
    return null;
  }
  const queued = new Set(
    [...queue.running, ...queue.waiting, ...queue.delayed]
      .filter((job) => inMonth(job, companyId, monthKey))
      .map((job) => job.driveFileId),
  );
  const pending = new Set(pendingFileIds);
  const finished = queue.recent.some(
    (job) =>
      inMonth(job, companyId, monthKey) &&
      pending.has(job.driveFileId) &&
      !queued.has(job.driveFileId),
  );
  if (finished) {
    return "finished";
  }
  const ready = servicesReady(queue);
  if (input.wereServicesReady === false && ready) {
    return "service-recovered";
  }
  if (ready && pendingFileIds.every((driveFileId) => !queued.has(driveFileId))) {
    return "idle";
  }
  return null;
}
