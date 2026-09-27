import type { ReaderOptions } from "zxing-wasm/reader";

import type { QrDecodeInput, QrRasterImage, QrReader } from "./port";
import { stretchRasterContrast } from "@/modules/raster-contrast";

const QR_READER_OPTIONS: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  maxNumberOfSymbols: 32,
};

function scaleRgba(image: QrRasterImage, factor: number): QrRasterImage {
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(
        image.width - 1,
        Math.floor((x / width) * image.width),
      );
      const sourceY = Math.min(
        image.height - 1,
        Math.floor((y / height) * image.height),
      );
      const sourceIndex = (sourceY * image.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = image.data[sourceIndex]!;
      data[targetIndex + 1] = image.data[sourceIndex + 1]!;
      data[targetIndex + 2] = image.data[sourceIndex + 2]!;
      data[targetIndex + 3] = image.data[sourceIndex + 3]!;
    }
  }
  return { data, width, height };
}

function textsFromReadResults(
  results: Array<{ text?: string; isValid?: boolean; error?: string }>,
): string[] {
  const texts: string[] = [];
  for (const result of results) {
    if (result.text && result.isValid !== false) {
      texts.push(result.text);
    }
  }
  return texts;
}

async function decodeOnce(input: QrDecodeInput): Promise<string[]> {
  const { readBarcodes } = await import("zxing-wasm/reader");
  if (input.kind === "encoded") {
    return textsFromReadResults(await readBarcodes(input.bytes, QR_READER_OPTIONS));
  }
  return textsFromReadResults(
    await readBarcodes(asImageData(input.image), QR_READER_OPTIONS),
  );
}

/**
 * Node has no `ImageData` class. zxing-wasm reads `data`, `width` and `height`
 * off the object, so a plain raster works at runtime; only the declared type
 * insists on the browser class.
 */
function asImageData(image: QrRasterImage): ImageData {
  return {
    data: image.data,
    width: image.width,
    height: image.height,
    colorSpace: "srgb",
  } as unknown as ImageData;
}

export function createZxingQrReader(): QrReader {
  return {
    async readAllCodes(input: QrDecodeInput): Promise<string[]> {
      const first = await decodeOnce(input);
      if (first.length > 0) {
        return first;
      }
      if (input.kind !== "rgba") {
        return first;
      }
      if (input.image.width <= 1 && input.image.height <= 1) {
        return first;
      }
      const stretched = stretchRasterContrast(input.image);
      if (stretched) {
        const fromStretched = await decodeOnce({ kind: "rgba", image: stretched });
        if (fromStretched.length > 0) {
          return fromStretched;
        }
      }
      const scaled = scaleRgba(input.image, 0.5);
      return decodeOnce({ kind: "rgba", image: scaled });
    },
  };
}
