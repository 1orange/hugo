import fs from "node:fs";
import path from "node:path";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import type { RgbaImage } from "../../../src/adapters/pdf/port.ts";

let writerPrepared = false;

function ensureWriterModule(): void {
  if (writerPrepared) {
    return;
  }

  const wasmPath = path.join(
    process.cwd(),
    "node_modules",
    "zxing-wasm",
    "dist",
    "writer",
    "zxing_writer.wasm",
  );
  prepareZXingModule({
    overrides: {
      wasmBinary: fs.readFileSync(wasmPath).buffer as ArrayBuffer,
    },
  });
  writerPrepared = true;
}

export async function createSyntheticEkasaQrImage(
  qrPayload: string,
): Promise<RgbaImage> {
  ensureWriterModule();
  const barcode = await writeBarcode(qrPayload, {
    format: "QRCode",
    scale: 8,
  });
  if (!barcode.image) {
    throw new Error("Barcode writer returned no image.");
  }
  const pngBytes = Buffer.from(await barcode.image.arrayBuffer());
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(pngBytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  return {
    width: image.width,
    height: image.height,
    data: imageData.data,
  };
}

export async function createSyntheticEkasaPdf(
  qrPayload: string,
): Promise<Uint8Array> {
  const image = await createSyntheticEkasaQrImage(qrPayload);
  return new Uint8Array(Buffer.from(`fixture:${qrPayload}:${image.width}x${image.height}`));
}
