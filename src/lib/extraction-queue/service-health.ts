import { hostname } from "node:os";
import { redis, redisKey } from "@/lib/redis/connection";

/**
 * Whether the model and OCR sidecars can read documents now. A document whose
 * service is unset or down waits as "pending" with no reason of its own
 * (ADR 0017), so the queue page says which one it waits for.
 */
/** "unknown": no worker has checked — none is running. */
export type ServiceState = "ok" | "loading" | "down" | "unconfigured" | "stub" | "unknown";

export type ServiceHealth = {
  state: ServiceState;
  /** Where the app sends requests; null when unset. */
  url: string | null;
  detail: string | null;
};

export type ExtractionServices = {
  model: ServiceHealth & { model: string | null };
  ocr: ServiceHealth;
};

const PING_TIMEOUT_MS = 1500;
/** The queue page polls every 1.5 s; the sidecars are asked at most this often. */
const CACHE_MS = 5000;

let cached: { at: number; key: string; services: ExtractionServices } | null = null;

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    if (error.name === "TimeoutError") {
      return `neodpovedá do ${PING_TIMEOUT_MS / 1000} s`;
    }
    return cause?.code ?? error.message;
  }
  return String(error);
}

async function ping(url: string, fetchImpl: typeof fetch): Promise<Pick<ServiceHealth, "state" | "detail">> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    if (response.status === 503) {
      // llama.cpp answers 503 while it loads the model.
      return { state: "loading", detail: "Načítava model" };
    }
    if (response.ok || response.status === 404) {
      // A server without /health (Ollama) still answered.
      return { state: "ok", detail: null };
    }
    return { state: "down", detail: `HTTP ${response.status}` };
  } catch (error) {
    return { state: "down", detail: describeFetchError(error) };
  }
}

/** The llama.cpp root for an OpenAI-style base URL: `…:8080/v1` → `…:8080`. */
function serverRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export async function checkExtractionServices(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractionServices> {
  const extractorMode = env.EXTRACTOR?.trim().toLowerCase();
  const ocrMode = env.OCR?.trim().toLowerCase();
  const extractorUrl = env.EXTRACTOR_URL?.trim() || null;
  const extractorModel = env.EXTRACTOR_MODEL?.trim() || null;
  const ocrUrl = env.OCR_URL?.trim() || null;
  const key = [extractorMode, ocrMode, extractorUrl, extractorModel, ocrUrl, env.DRIVE_CLIENT].join("|");
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) {
    return cached.services;
  }

  const fake = env.DRIVE_CLIENT === "fake";
  const checkModel = async (): Promise<ExtractionServices["model"]> => {
    if (extractorMode === "stub" || fake) {
      return { state: "stub", url: null, model: null, detail: "Stub extraktor (EXTRACTOR=stub alebo DRIVE_CLIENT=fake)" };
    }
    if (!extractorUrl || !extractorModel) {
      return {
        state: "unconfigured",
        url: extractorUrl,
        model: extractorModel,
        detail: "EXTRACTOR_URL a EXTRACTOR_MODEL nie sú nastavené v .env",
      };
    }
    return { url: extractorUrl, model: extractorModel, ...(await ping(`${serverRoot(extractorUrl)}/health`, fetchImpl)) };
  };
  const checkOcr = async (): Promise<ServiceHealth> => {
    if (ocrMode === "fake" || fake) {
      return { state: "stub", url: null, detail: "Falošné OCR (OCR=fake alebo DRIVE_CLIENT=fake)" };
    }
    if (!ocrUrl) {
      return { state: "unconfigured", url: null, detail: "OCR_URL nie je nastavené v .env" };
    }
    return { url: ocrUrl, ...(await ping(`${ocrUrl.replace(/\/+$/, "")}/health`, fetchImpl)) };
  };
  const [model, ocr] = await Promise.all([checkModel(), checkOcr()]);

  const services = { model, ocr };
  cached = { at: Date.now(), key, services };
  return services;
}

// --- Shared through Redis (ADR 0021) ---------------------------------------
// Only a worker talks to the model and OCR, so only workers check them. Each
// keeps its own finding in Redis for a minute; the web replicas read them all.

/** A report older than this means that worker stopped checking. */
const REPORT_TTL_SECONDS = 30;

/** This process, among the workers: several can run, on several nodes. */
const WORKER_ID = `${hostname()}:${process.pid}`;

function reportKey(workerId: string = WORKER_ID): string {
  return redisKey("services", workerId);
}

export type ServicesReport = {
  services: ExtractionServices;
  checkedAt: string;
  workerId: string;
};

export async function storeServicesReport(services: ExtractionServices, now: Date = new Date()): Promise<void> {
  const report: ServicesReport = { services, checkedAt: now.toISOString(), workerId: WORKER_ID };
  await redis().set(reportKey(), JSON.stringify(report), "EX", REPORT_TTL_SECONDS);
}

const SEVERITY: Record<ServiceState, number> = {
  down: 5,
  unconfigured: 4,
  loading: 3,
  unknown: 2,
  ok: 1,
  stub: 0,
};

function worst<T extends ServiceHealth>(healths: T[]): T {
  return healths.reduce((picked, health) => (SEVERITY[health.state] > SEVERITY[picked.state] ? health : picked));
}

/**
 * What the live workers found, merged: a service is as good as the worst
 * report of it — a worker that cannot reach the model leaves its documents
 * waiting, whatever the others see. Null when no worker has reported.
 */
export async function readServicesReport(): Promise<{ report: ServicesReport | null; workers: number }> {
  const keys = await redis().keys(`${reportKey("*")}`);
  if (keys.length === 0) {
    return { report: null, workers: 0 };
  }
  const reports = (await redis().mget(...keys))
    .filter((raw): raw is string => raw !== null)
    .map((raw) => JSON.parse(raw) as ServicesReport);
  if (reports.length === 0) {
    return { report: null, workers: 0 };
  }
  const newest = reports.reduce((picked, report) => (report.checkedAt > picked.checkedAt ? report : picked));
  return {
    report: {
      services: {
        model: worst(reports.map((report) => report.services.model)),
        ocr: worst(reports.map((report) => report.services.ocr)),
      },
      checkedAt: newest.checkedAt,
      workerId: reports.length === 1 ? newest.workerId : `${reports.length} workers`,
    },
    workers: reports.length,
  };
}

/** Only the states: a changed URL or detail is not news to a screen. */
export function servicesFingerprint(services: ExtractionServices): string {
  return `${services.model.state}|${services.ocr.state}`;
}

export function servicesReady(services: ExtractionServices): boolean {
  const ready = (state: ServiceState) => state === "ok" || state === "stub";
  return ready(services.model.state) && ready(services.ocr.state);
}
