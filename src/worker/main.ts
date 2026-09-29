import http from "node:http";
import { closeQueues } from "@/adapters/job-queue/bullmq-queues";
import { closeDb, runMigrations } from "@/lib/db/client";
import { closeRedis, redis } from "@/lib/redis/connection";
import { startWorker } from "@/lib/worker/start";

/**
 * The worker process (HUGO_ROLE=worker, ADR 0021): reads documents and sweeps
 * Drive. It serves /healthz for Kubernetes on WORKER_HEALTH_PORT (9464), and
 * on SIGTERM finishes the documents it is reading before it exits.
 */
async function main(): Promise<void> {
  await runMigrations();
  const worker = await startWorker();
  console.log("[worker] reading documents");

  const port = Number(process.env.WORKER_HEALTH_PORT) || 9464;
  const server = http
    .createServer((request, response) => {
      if (request.url !== "/healthz") {
        response.writeHead(404).end();
        return;
      }
      redis()
        .ping()
        .then(
          () => response.writeHead(200, { "Content-Type": "text/plain" }).end("ok"),
          () => response.writeHead(503, { "Content-Type": "text/plain" }).end("redis unreachable"),
        );
    })
    .listen(port);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[worker] ${signal}: finishing the documents being read`);
    server.close();
    await worker.close();
    await closeQueues();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("[worker] could not start", error);
  process.exit(1);
});
