import { createEkasaLookup } from "@/adapters/ekasa-lookup/create-ekasa-lookup";
import { createExtractor } from "@/adapters/extractor/create-extractor";
import { createOcr } from "@/adapters/ocr/create-ocr";
import { createPdfAccess } from "@/adapters/pdf/pdf-access";
import { createZxingQrReader } from "@/adapters/qr-reader/zxing-qr-reader";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
import {
  createDocumentExtractionQueue,
  extractionConcurrency,
  type DocumentExtractionQueue,
} from "@/lib/extraction-queue/document-queue";
import type { CashDiscoveryDeps } from "./discover-cash-payments";

export function createCashDiscoveryDeps(
  env: NodeJS.ProcessEnv = process.env,
): CashDiscoveryDeps {
  return {
    driveClient: createDriveClient(env),
    pdfAccess: createPdfAccess(),
    qrReader: createZxingQrReader(),
    ekasaLookup: createEkasaLookup(env),
    ocr: createOcr(env),
    extractor: createExtractor(env),
  };
}

// One queue per process, kept across Next's module reloads in development.
const QUEUE_KEY = Symbol.for("hugo.documentExtractionQueue");

export function documentExtractionQueue(env: NodeJS.ProcessEnv = process.env): DocumentExtractionQueue {
  const holder = globalThis as unknown as Record<symbol, DocumentExtractionQueue | undefined>;
  holder[QUEUE_KEY] ??= createDocumentExtractionQueue(createCashDiscoveryDeps(env), extractionConcurrency(env));
  return holder[QUEUE_KEY];
}

/** Queues the month's unread documents in the background; never awaited by a page. */
export function scheduleDocumentExtractionForMonth(
  companyId: number,
  monthKey: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  documentExtractionQueue(env).enqueueMonth(companyId, monthKey);
}
