import type { Worker } from "bullmq";
import { askModelSlots } from "@/adapters/extractor/model-slots";
import { extractionModelQueue } from "@/adapters/job-queue/bullmq-queues";
import type { ModelJobData } from "@/adapters/job-queue/port";
import type { ModelLimitSource } from "@/lib/extraction-queue/types";
import { redis, redisKey } from "@/lib/redis/connection";

export type ModelLaneSize = {
  /** Documents the model lane reads at once, across every worker. */
  concurrency: number;
  source: ModelLimitSource;
  /** Why the server's slots are not used, when they are not. */
  reason: string | null;
};

/**
 * The model lane's limit when the server cannot say its own: EXTRACTOR_CONCURRENCY,
 * or 1. Only a fallback: `-np` on the server is the setting that counts.
 */
export function fallbackModelConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.EXTRACTOR_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/** The server that answers for the model, or null when the model is not read from one. */
function modelServerUrl(env: NodeJS.ProcessEnv): string | null {
  const mode = env.EXTRACTOR?.trim().toLowerCase();
  if (mode === "stub" || env.DRIVE_CLIENT === "fake") {
    return null;
  }
  return env.EXTRACTOR_URL?.trim() || null;
}

/** Asks the model server for its slots, and falls back when it cannot say. Never throws. */
export async function chooseModelLaneSize(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<ModelLaneSize> {
  const fallback = (reason: string): ModelLaneSize => ({
    concurrency: fallbackModelConcurrency(env),
    source: "fallback",
    reason,
  });
  const url = modelServerUrl(env);
  if (!url) {
    return fallback("model sa nečíta zo servera");
  }
  const answer = await askModelSlots(url, { fetchImpl });
  if (answer.slots === null) {
    return fallback(answer.reason);
  }
  return { concurrency: answer.slots, source: "server", reason: null };
}

function modelLaneKey(): string {
  return redisKey("extraction", "model-lane");
}

/**
 * Sets the model lane to the size, on this worker and for every worker: the
 * queue's global limit is what holds the model to its slots. The size goes to
 * Redis too, for the queue page.
 */
export async function applyModelLaneSize(worker: Worker<ModelJobData>, size: ModelLaneSize): Promise<void> {
  worker.concurrency = size.concurrency;
  await extractionModelQueue().setGlobalConcurrency(size.concurrency);
  await redis().set(modelLaneKey(), JSON.stringify({ concurrency: size.concurrency, source: size.source }));
}

/** The model lane's size as the last worker set it; null when none has. */
export async function readModelLaneSize(): Promise<{ concurrency: number; source: ModelLimitSource } | null> {
  const raw = await redis().get(modelLaneKey());
  return raw ? (JSON.parse(raw) as { concurrency: number; source: ModelLimitSource }) : null;
}
