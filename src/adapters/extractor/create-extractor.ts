import { createHttpExtractor } from "./http-extractor";
import { createStubExtractor } from "./stub-extractor";
import type { Extractor } from "./port";

function unconfiguredExtractor(): Extractor {
  return {
    async extract() {
      throw new Error("Extractor is unreachable: EXTRACTOR_URL and EXTRACTOR_MODEL are not set.");
    },
  };
}

export function createExtractor(env: NodeJS.ProcessEnv = process.env): Extractor {
  const mode = env.EXTRACTOR?.trim().toLowerCase();
  if (mode === "stub" || env.DRIVE_CLIENT === "fake") {
    if (env.NODE_ENV === "production" && mode === "stub") {
      throw new Error(
        "EXTRACTOR=stub must never be used in production: it replaces real extraction with empty fields",
      );
    }
    return createStubExtractor();
  }

  const baseUrl = env.EXTRACTOR_URL?.trim();
  const model = env.EXTRACTOR_MODEL?.trim();
  if (!baseUrl || !model) {
    // In production too: ADR 0017 leaves the model unset until it is measured
    // on the node that will run it, and this runs inside a page render — a
    // throw here took the dashboard down with it.
    // Not configured is not the same as "read nothing": the stub marked real
    // invoices complete with empty fields, and complete documents are never
    // read again. Behave like a model that is down, so documents wait for one.
    return unconfiguredExtractor();
  }

  const timeoutMs = Number(env.EXTRACTOR_TIMEOUT_MS);
  const maxTokens = Number(env.EXTRACTOR_MAX_TOKENS);
  return createHttpExtractor({
    baseUrl,
    model,
    thinkingEnabled: env.EXTRACTOR_THINKING === "true",
    ...(timeoutMs > 0 ? { timeoutMs } : {}),
    ...(maxTokens > 0 ? { maxTokens } : {}),
  });
}
