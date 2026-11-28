import { Worker, type Job } from "bullmq";
import { CLIENT_SUBJECT_JOB, SUBJECT_QUEUE } from "@/adapters/job-queue/bullmq-queues";
import type {
  ClientSubjectVerificationJobData,
  SubjectVerificationJobData,
} from "@/adapters/job-queue/port";
import { openRedisConnection, redisKeyPrefix } from "@/lib/redis/connection";
import { verifyClientSubject } from "@/lib/subject-directory/client-subject";
import { workerDirectoryDeps } from "@/lib/subject-directory/runtime";
import { SubjectLookupDeferred } from "@/lib/subject-directory/service";
import { verifyDocumentParties } from "@/lib/subject-directory/verify-document";

/**
 * Checks each queued document's parties, and each client's subject, against the registers,
 * one at a time: the lookups are rate-limited and the directory dedupes them, so a second
 * worker only adds resilience (ADR 0022).
 *
 * A lookup refused by the rate limit is not a failure: the whole queue pauses until the
 * limiter has a slot and the job goes back to wait, its attempts untouched. Before, each
 * refusal failed the job (a stack trace in the log), and after 60 refusals in a big backlog
 * the check was dropped.
 */
export function startSubjectWorker(
  env: NodeJS.ProcessEnv = process.env,
  options: { process?: (job: Job<SubjectJobData>) => Promise<void> } = {},
): { worker: Worker; busy: () => boolean } {
  let checking = false;
  const check = options.process ?? ((job: Job<SubjectJobData>) => checkSubjects(job, env));
  const worker: Worker<SubjectJobData> = new Worker<SubjectJobData>(
    SUBJECT_QUEUE,
    async (job: Job<SubjectJobData>) => {
      checking = true;
      try {
        await check(job);
      } catch (error) {
        if (error instanceof SubjectLookupDeferred) {
          await worker.rateLimit(rateLimitPauseMs(error.retryAfterMs));
          throw Worker.RateLimitError();
        }
        throw error;
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

type SubjectJobData = SubjectVerificationJobData | ClientSubjectVerificationJobData;

async function checkSubjects(job: Job<SubjectJobData>, env: NodeJS.ProcessEnv): Promise<void> {
  const deps = await workerDirectoryDeps(env);
  if (job.name === CLIENT_SUBJECT_JOB) {
    await verifyClientSubject((job.data as ClientSubjectVerificationJobData).subjectId, deps);
  } else {
    await verifyDocumentParties((job.data as SubjectVerificationJobData).documentId, deps);
  }
}

/** The pause after a refusal: until the limiter has a slot, at least a second, at most a minute. */
export function rateLimitPauseMs(retryAfterMs: number): number {
  return Math.min(60_000, Math.max(1_000, Math.ceil(retryAfterMs)));
}
