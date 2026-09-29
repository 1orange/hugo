import type { ExtractionStage } from "@/modules/extraction-progress";

export type QueueJobIdentity = {
  driveFileId: string;
  kind: "receipt" | "document";
  companyId: number;
  companyName: string;
  monthKey: string;
  fileName: string;
};

export type QueueJobView = QueueJobIdentity & {
  /** "delayed": it waits for the model or OCR, and is tried again when they are back. */
  state: "waiting" | "running" | "delayed";
  enqueuedAt: string;
  startedAt: string | null;
  stage: ExtractionStage;
  stageLabel: string;
  percent: number;
  /** Since the job started; 0 while it waits. */
  elapsedMs: number;
  waitingReason: string | null;
};

/** "waiting": the document is still pending — the model or OCR was down. */
export type QueueOutcome = "complete" | "failed" | "waiting";

export type FinishedJobView = QueueJobIdentity & {
  finishedAt: string;
  durationMs: number;
  outcome: "complete" | "failed";
  reason: string | null;
};

export type QueueSnapshot = {
  /** Documents read at once across every worker (the model server's slots). */
  concurrency: number;
  running: QueueJobView[];
  /** In the order they will be read. */
  waiting: QueueJobView[];
  /** Waiting for the model or OCR. */
  delayed: QueueJobView[];
  /** Newest first, one row per file. */
  recent: FinishedJobView[];
};
