import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPdfAccess } from "../../../src/adapters/pdf/pdf-access.ts";
import { createZxingQrReader } from "../../../src/adapters/qr-reader/zxing-qr-reader.ts";
import {
  findEkasaUidFromQrPayloads,
  readQrPayloadsFromPdf,
  readQrPayloadsFromPhoto,
} from "../../../src/lib/cash-discovery/ekasa-qr-extraction.ts";

const CORPUS_DIR = path.join(process.cwd(), "tests/private-fixtures/qr-corpus");
const EXPECTED_PATH = path.join(CORPUS_DIR, "expected.json");

function photoMimeType(name: string): string {
  return /\.heic$/i.test(name) ? "image/heif" : "image/jpeg";
}

// Issue 02's acceptance check, against her real scans and photos: 8 of 12
// resolve to a UID, and the parking-machine receipts, the PAY by square
// invoice and the printer-damaged photo do not.
test(
  "QR decoding finds the expected eKasa UID in every real scan and photo",
  { skip: fs.existsSync(EXPECTED_PATH) ? false : "tests/private-fixtures/qr-corpus absent" },
  async () => {
    const { expected } = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8")) as {
      expected: Record<string, string | null>;
    };
    const pdfAccess = createPdfAccess();
    const qrReader = createZxingQrReader();

    for (const [name, expectedUid] of Object.entries(expected)) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(CORPUS_DIR, name)));
      const payloads = name.toLowerCase().endsWith(".pdf")
        ? await readQrPayloadsFromPdf(bytes, pdfAccess, qrReader)
        : await readQrPayloadsFromPhoto({ bytes, mimeType: photoMimeType(name) }, qrReader);
      const found = await findEkasaUidFromQrPayloads(payloads);
      assert.equal(found.ok ? found.uid : null, expectedUid, name);
    }
  },
);
