import { createEkasaLookup } from "@/adapters/ekasa-lookup/create-ekasa-lookup";
import { createExtractor } from "@/adapters/extractor/create-extractor";
import { createOcr } from "@/adapters/ocr/create-ocr";
import { createPdfAccess } from "@/adapters/pdf/pdf-access";
import { createZxingQrReader } from "@/adapters/qr-reader/zxing-qr-reader";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
import { scheduleModelExtractionForMonthFromEnv } from "@/lib/model-extraction/schedule";
import {
  scheduleCashPaymentDiscovery,
  type CashDiscoveryDeps,
} from "./discover-cash-payments";

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

export function scheduleCashDiscoveryForMonth(
  companyId: number,
  monthKey: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  scheduleCashPaymentDiscovery(companyId, monthKey, createCashDiscoveryDeps(env));
}

export function scheduleDocumentExtractionForMonth(
  companyId: number,
  monthKey: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  scheduleCashDiscoveryForMonth(companyId, monthKey, env);
  scheduleModelExtractionForMonthFromEnv(companyId, monthKey, env);
}
