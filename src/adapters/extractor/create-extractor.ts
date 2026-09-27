import { createHttpExtractor } from "./http-extractor";
import { createStubExtractor } from "./stub-extractor";
import type { Extractor } from "./port";

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
    if (env.NODE_ENV === "production") {
      throw new Error("EXTRACTOR_URL and EXTRACTOR_MODEL are required in production");
    }
    return createStubExtractor();
  }

  return createHttpExtractor({
    baseUrl,
    model,
    thinkingEnabled: env.EXTRACTOR_THINKING === "true",
  });
}
