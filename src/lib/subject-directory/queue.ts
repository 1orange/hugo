import { BullmqSubjectVerificationQueue } from "@/adapters/job-queue/bullmq-queues";
import { MemorySubjectVerificationQueue } from "@/adapters/job-queue/memory-subject-verification-queue";
import type { SubjectVerificationQueue } from "@/adapters/job-queue/port";
import { redisUrl } from "@/lib/redis/connection";

/**
 * Where party checks are queued: the shared queue when Redis is configured;
 * otherwise an in-process list, which tests read. Nothing drains that list.
 */
const bullmq = new BullmqSubjectVerificationQueue();
const memory = new MemorySubjectVerificationQueue();
let override: SubjectVerificationQueue | null = null;

export function subjectVerificationQueue(): SubjectVerificationQueue {
  if (override) {
    return override;
  }
  return redisUrl() ? bullmq : memory;
}

/** Test seam: replaces the queue (null restores the default). */
export function useSubjectVerificationQueue(queue: SubjectVerificationQueue | null): void {
  override = queue;
}
