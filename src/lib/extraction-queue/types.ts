import type { ExtractionStage } from "@/modules/extraction-progress";
import type { StageTiming } from "@/modules/extraction-timing";
import type { WaitingMonth } from "./waiting";

/** The reading lane (download, text, OCR) and the model lane (ADR 0020). */
export type QueueLane = "read" | "model";

export const LANE_LABEL: Record<QueueLane, string> = {
  read: "Čítanie",
  model: "Model",
};

export type QueueJobIdentity = {
  driveFileId: string;
  kind: "receipt" | "document";
  companyId: number;
  companyName: string;
  monthKey: string;
  fileName: string;
};

export type QueueJobView = QueueJobIdentity & {
  lane: QueueLane;
  /** "delayed": it waits for the model or OCR, and is tried again when they are back. */
  state: "waiting" | "running" | "delayed";
  enqueuedAt: string;
  startedAt: string | null;
  stage: ExtractionStage;
  /** Names the lane first: "Čítanie · OCR · 3 strany", "Model · V rade". */
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
  /** The whole of the document, from the reading lane's start to its end. */
  durationMs: number;
  outcome: "complete" | "failed";
  reason: string | null;
  /** Absent on records written before stages were kept: they show their total only. */
  stages?: StageTiming[];
};

/**
 * Where the model lane's limit came from: the model server's slots (llama.cpp
 * `-np`), or the fallback (EXTRACTOR_CONCURRENCY, or 1) when it did not say.
 */
export type ModelLimitSource = "server" | "fallback";

export type QueueSnapshot = {
  /** Documents read at once across every worker, per lane. */
  concurrency: { read: number; model: number };
  /** Null until a worker has sized the model lane. */
  modelSource: ModelLimitSource | null;
  /** Being read, in either lane. */
  running: QueueJobView[];
  /** In the order they will be read, per lane: the reading lane first. */
  waiting: QueueJobView[];
  /** Waiting for the model or OCR. */
  delayed: QueueJobView[];
  /** Newest first, one row per file. */
  recent: FinishedJobView[];
  /**
   * Waiting documents per company and month, in the order they will be read,
   * counted over the whole queue (not the capped lists above). Running documents
   * are not waiting, so they are not here.
   */
  waitingMonths: WaitingMonth[];
};
