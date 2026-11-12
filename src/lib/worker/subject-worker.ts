import { Worker, type Job } from "bullmq";
import { SUBJECT_QUEUE } from "@/adapters/job-queue/bullmq-queues";
import type { SubjectVerificationJobData } from "@/adapters/job-queue/port";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";
import { workerDirectoryDeps } from "@/lib/subject-directory/runtime";
import { verifyDocumentParties } from "@/lib/subject-directory/verify-document";

/**
 * Checks each document's parties against the registers, one at a time: the
 * lookups are rate-limited and the directory dedupes them, so a second worker
 * only adds resilience (ADR 0022). A lookup refused by the rate limit throws,
 * and BullMQ tries the document again a minute later.
 */
export function startSubjectWorker(env: NodeJS.ProcessEnv = process.env): { worker: Worker; busy: () => boolean } {
  let checking = false;
  const worker = new Worker<SubjectVerificationJobData>(
    SUBJECT_QUEUE,
    async (job: Job<SubjectVerificationJobData>) => {
      checking = true;
      try {
        await verifyDocumentParties(job.data.documentId, await workerDirectoryDeps(env));
      } finally {
        checking = false;
      }
    },
    {
      connection: openRedisConnection(),
      prefix: redisKeyPrefix(),
      concurrency: 1,
      // Two lookups of up to ~8 s each, and the wait for another replica's: well inside the lock.
      lockDuration: 120_000,
    },
  );
  return { worker, busy: () => checking };
}
