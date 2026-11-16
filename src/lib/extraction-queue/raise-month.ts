import { BullmqExtractionJobQueue } from "@/adapters/job-queue/bullmq-queues";
import type { ExtractionJobQueue } from "@/adapters/job-queue/port";

/**
 * A Redis that does not answer never fails a command here, it holds it: the
 * raise gives up after this and the page's background work ends.
 */
export const RAISE_TIMEOUT_MS = 15_000;

/**
 * Opening a month moves its waiting documents, in both lanes, ahead of the rest
 * of the queue. Called after the response (`after()`), never in the render path.
 * It never throws: with Redis down the queue keeps its order, and the next open
 * raises again.
 */
export async function raiseMonthForReading(
  companyId: number,
  monthKey: string,
  queue: ExtractionJobQueue = new BullmqExtractionJobQueue(),
  timeoutMs: number = RAISE_TIMEOUT_MS,
): Promise<void> {
  try {
    await withTimeout(queue.raiseMonth(companyId, monthKey), timeoutMs);
  } catch (error) {
    console.warn(`[queue] could not raise ${companyId}/${monthKey}`, error);
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from Redis after ${ms} ms`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
