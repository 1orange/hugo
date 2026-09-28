import jpeg from "jpeg-js";
import type { RgbaRaster } from "@/modules/raster-contrast";

/**
 * Pure-JS JPEG decode, so the QR retries can clean up a photo's pixels without
 * a native image library. The EXIF orientation is not applied: the decoder
 * tries rotations itself, and the streak retries try both axes.
 */
export function jpegToRaster(bytes: Uint8Array): RgbaRaster | null {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  try {
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      // A 12-megapixel phone photo is ~48 MB of RGBA.
      maxMemoryUsageInMB: 1024,
    });
    return {
      data: new Uint8ClampedArray(
        decoded.data.buffer,
        decoded.data.byteOffset,
        decoded.data.byteLength,
      ),
      width: decoded.width,
      height: decoded.height,
    };
  } catch {
    return null;
  }
}
