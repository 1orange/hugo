import { loadDriveSyncPanel } from "@/lib/drive-watch/drive-sync-status";
import type { DriveSyncPanel } from "@/modules/drive-sync";
import { estimateQueueEmpty, type QueueEstimate } from "@/modules/queue-estimate";
import { readServicesReport, type ExtractionServices } from "./service-health";
import { loadQueueSnapshot } from "./snapshot";
import type { QueueSnapshot } from "./types";
import { waitingTotals } from "./waiting";

export type ExtractionQueueView = QueueSnapshot & {
  services: ExtractionServices;
  /** When the queue will be empty, from the waiting counts and the recent records (0007/02). */
  estimate: QueueEstimate;
  /** A worker has reported in the last half minute; without one nothing is read. */
  workerAlive: boolean;
  /** Workers that reported in the last half minute. */
  workers: number;
  checkedAt: string | null;
  /** Drive push and poll, as the Drive panel shows them (0007/03). */
  drive: DriveSyncPanel;
};

const NO_REPORT: ExtractionServices = {
  model: { state: "unknown", url: null, model: null, detail: "Žiadny worker ho nekontroluje." },
  ocr: { state: "unknown", url: null, detail: "Žiadny worker ho nekontroluje." },
};

/** The queue page's data, and what the event stream sends each screen. */
export async function loadExtractionQueueView(): Promise<ExtractionQueueView> {
  const [snapshot, { report, workers }, drive] = await Promise.all([
    loadQueueSnapshot(),
    readServicesReport(),
    loadDriveSyncPanel(),
  ]);
  const totals = waitingTotals(snapshot.waitingMonths);
  return {
    ...snapshot,
    estimate: estimateQueueEmpty({
      readingWaiting: totals.reading,
      modelWaiting: totals.model,
      readingConcurrency: snapshot.concurrency.read,
      modelConcurrency: snapshot.concurrency.model,
      records: snapshot.recent,
    }),
    services: report?.services ?? NO_REPORT,
    workerAlive: workers > 0,
    workers,
    checkedAt: report?.checkedAt ?? null,
    drive,
  };
}
