import fs from "node:fs";
import path from "node:path";
import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";
import type { QrDecoder, RgbaImage } from "./port";

let prepared = false;

function ensureZxingModule(): void {
  if (prepared) {
    return;
  }

  const wasmPath = path.join(
    process.cwd(),
    "node_modules",
    "zxing-wasm",
    "dist",
    "reader",
    "zxing_reader.wasm",
  );
  prepareZXingModule({
    overrides: {
      wasmBinary: fs.readFileSync(wasmPath).buffer as ArrayBuffer,
    },
  });
  prepared = true;
}

export function createZxingQrDecoder(): QrDecoder {
  return {
    async decodeFromImage(image: RgbaImage): Promise<string | null> {
      ensureZxingModule();
      const results = await readBarcodes(
        {
          data: new Uint8ClampedArray(image.data),
          width: image.width,
          height: image.height,
          colorSpace: "srgb",
        } as ImageData,
        {
          formats: ["QRCode"],
          tryHarder: true,
        },
      );

      return results[0]?.text ?? null;
    },
  };
}
