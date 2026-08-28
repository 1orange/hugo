import { createPdfAccess } from "@/adapters/pdf/pdf-access";
import { createZxingQrDecoder } from "@/adapters/pdf/zxing-qr-decoder";
import { createDriveClient } from "@/adapters/drive/create-drive-client";
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
    qrDecoder: createZxingQrDecoder(),
  };
}

export function scheduleCashDiscoveryForMonth(
  companyId: number,
  monthKey: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  scheduleCashPaymentDiscovery(companyId, monthKey, createCashDiscoveryDeps(env));
}
