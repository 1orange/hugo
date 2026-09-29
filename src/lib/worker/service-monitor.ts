import { extractionQueue } from "@/adapters/job-queue/bullmq-queues";
import { announce } from "@/lib/events/bus";
import {
  checkExtractionServices,
  servicesFingerprint,
  servicesReady,
  storeServicesReport,
} from "@/lib/extraction-queue/service-health";

const CHECK_EVERY_MS = 10_000;

/**
 * Checks the model and OCR every ten seconds, for the screens (this worker's
 * report, in Redis — its presence says the worker is alive) and for the queue: when a service comes
 * back, every document waiting for it is tried at once.
 */
export function startServiceMonitor(env: NodeJS.ProcessEnv = process.env): () => void {
  let fingerprint: string | null = null;
  let wasReady: boolean | null = null;
  let checking = false;

  const check = async () => {
    if (checking) {
      return;
    }
    checking = true;
    try {
      const services = await checkExtractionServices(env);
      await storeServicesReport(services);
      const next = servicesFingerprint(services);
      if (next !== fingerprint) {
        fingerprint = next;
        announce({ type: "services-changed" });
      }
      const ready = servicesReady(services);
      if (wasReady === false && ready) {
        await extractionQueue().promoteJobs();
        announce({ type: "queue-changed" });
      }
      wasReady = ready;
    } catch (error) {
      console.warn("[worker] service check failed", error);
    } finally {
      checking = false;
    }
  };

  void check();
  const timer = setInterval(() => void check(), CHECK_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
