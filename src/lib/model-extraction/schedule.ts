import { createExtractor } from "@/adapters/extractor/create-extractor";
import { createOcr } from "@/adapters/ocr/create-ocr";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { createPdfAccess } from "@/adapters/pdf/pdf-access";
import {
  scheduleModelExtractionForMonth,
  type ModelExtractionDeps,
} from "./discover-model-extraction";

export function createModelExtractionDeps(
  env: NodeJS.ProcessEnv = process.env,
): ModelExtractionDeps {
  const concurrencyRaw = env.EXTRACTOR_CONCURRENCY?.trim();
  const concurrency = concurrencyRaw ? Number(concurrencyRaw) : undefined;
  return {
    driveClient: createDriveClient(env),
    pdfAccess: createPdfAccess(),
    ocr: createOcr(env),
    extractor: createExtractor(env),
    concurrency:
      concurrency !== undefined && Number.isFinite(concurrency) && concurrency > 0
        ? concurrency
        : undefined,
  };
}

export function scheduleModelExtractionForMonthFromEnv(
  companyId: number,
  monthKey: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  scheduleModelExtractionForMonth(companyId, monthKey, createModelExtractionDeps(env));
}
