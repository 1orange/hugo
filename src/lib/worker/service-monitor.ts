import { extractionModelQueue, extractionQueue } from "@/adapters/job-queue/bullmq-queues";
import { announce } from "@/lib/events/bus";
import {
  checkExtractionServices,
  modelBecameReady,
  servicesBackOnline,
  servicesFingerprint,
  serviceReadiness,
  storeServicesReport,
  type ServiceReadiness,
} from "@/lib/extraction-queue/service-health";

const CHECK_EVERY_MS = 10_000;

/**
 * Checks the model and OCR every ten seconds, for the screens (this worker's
 * report, in Redis — its presence says the worker is alive) and for the queues:
 * when a service comes back, every document waiting for it is tried at once.
 * The model lane waits on the model, the reading lane on OCR. When the model is
 * ready, `onModelReady` sizes the model lane again: the model may have come back
 * with other slots, or may not have answered at start-up.
 */
export function startServiceMonitor(
  env: NodeJS.ProcessEnv = process.env,
  options: { onModelReady?: () => Promise<unknown> } = {},
): () => void {
  let fingerprint: string | null = null;
  let previous: ServiceReadiness | null = null;
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
      const readiness = serviceReadiness(services);
      if (modelBecameReady(previous, readiness) && options.onModelReady) {
        // Before the waiting documents are tried, so they meet the new limit. A
        // failure here must not keep them from being tried.
        try {
          await options.onModelReady();
        } catch (error) {
          console.warn("[worker] could not size the model lane", error);
        }
      }
      const back = servicesBackOnline(previous, readiness);
      previous = readiness;
      if (back.ocr) {
        await extractionQueue().promoteJobs();
      }
      if (back.model) {
        await extractionModelQueue().promoteJobs();
      }
      if (back.ocr || back.model) {
        announce({ type: "queue-changed" });
      }
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
