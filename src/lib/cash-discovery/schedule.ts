import { createEkasaLookup } from "@/adapters/ekasa-lookup/create-ekasa-lookup";
import { createExtractor } from "@/adapters/extractor/create-extractor";
import { createOcr } from "@/adapters/ocr/create-ocr";
import { createPdfAccess } from "@/adapters/pdf/pdf-access";
import { createZxingQrReader } from "@/adapters/qr-reader/zxing-qr-reader";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { BullmqExtractionJobQueue } from "@/adapters/job-queue/bullmq-queues";
import { enqueueMonthExtraction } from "@/lib/extraction-queue/enqueue";
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

/**
 * Queues the month's unread documents for the workers. A page render must not
 * fail because Redis hiccuped: the sweep and the next render queue them again.
 */
export async function scheduleDocumentExtractionForMonth(companyId: number, monthKey: string): Promise<void> {
  try {
    await enqueueMonthExtraction(new BullmqExtractionJobQueue(), companyId, monthKey);
  } catch (error) {
    console.warn(`[queue] could not queue ${companyId}/${monthKey}`, error);
  }
}
